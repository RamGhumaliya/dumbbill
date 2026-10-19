import { Injectable, StreamableFile } from '@nestjs/common';
import { Prisma, Product, ProductCategory } from '@prisma/client';
import { Clock } from '../../common/clock';
import { DomainError, FieldError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { LoadedAccess } from '../permissions/access.service';
import { buildStorageKey } from '../storage/storage-key';
import { FileStorage } from '../storage/storage.types';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import {
  CategoryDto,
  PriceDto,
  PriceHistoryDto,
  ProductAdminDto,
  ProductCashierDto,
  ProductListDto,
  ProductOptionsDto,
} from './dto/catalogue-responses.dto';
import {
  ChangePriceDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/catalogue-requests.dto';
import { ALLOWED_GST_RATES_BP } from './domain/gst-rates';
import { marginBp, priceErrors, productFieldErrors, ProductFields } from './domain/product-rules';
import { makeProductImages } from './images/product-images';

/** A product with its category, as read from the database. */
type ProductRow = Product & { category: ProductCategory | null };

/** The price in force for a product. */
interface CurrentPrice {
  mrpPaise: number;
  pricePaise: number;
}

/** Can this person see what things cost? (Only `products.cost.read` may; the owner always can.) */
export function canSeeCost(actor: LoadedAccess): boolean {
  return actor.permissions.has('products.cost.read');
}

/** Throw the standard "some fields are invalid" error when there are problems. */
export function failIfAny(errors: FieldError[]): void {
  if (errors.length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', errors);
  }
}

/**
 * Products: create, edit, search, switch off, prices and pictures.
 *
 * Rules enforced here (US-PROD-01, US-PRICE-01):
 *  - A barcode and a SKU are unique inside a business; so is the combination of name, brand and variant.
 *  - HSN and GST rate are required when the business has a GSTIN (every tax invoice must carry them).
 *  - Prices are whole paise; the selling price may not exceed the MRP. A price is NEVER edited: changing it adds a row
 *    to the append-only price history with who, when and why, and the price in force is the newest row that has started.
 *  - Cost is confidential: only people with `products.cost.read` may see or set it, and a person without it gets a
 *    response type that has no cost field at all (ProductCashierDto).
 *  - Products are switched off, never deleted.
 *  - Row-level security keeps businesses apart, so another business's product is a 404.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  /** What the product form needs: the categories, the allowed GST rates, and whether tax details are required. */
  async options(): Promise<ProductOptionsDto> {
    return this.tenantTx.run(async (tx) => {
      const [categories, tenant] = await Promise.all([
        tx.productCategory.findMany({ orderBy: { name: 'asc' } }),
        tx.tenant.findFirstOrThrow({ select: { gstin: true } }),
      ]);
      return {
        categories: categories.map(toCategoryDto),
        gstRatesBp: [...ALLOWED_GST_RATES_BP],
        taxDetailsRequired: tenant.gstin !== null,
      };
    });
  }

  /** A page of products, filtered. Newest rule of thumb: name order, so the table is stable between pages. */
  async list(actor: LoadedAccess, query: ListProductsQueryDto): Promise<ProductListDto> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const status = query.status ?? 'active';
    const where: Prisma.ProductWhereInput = {
      ...(status === 'all' ? {} : { isActive: status === 'active' }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { brand: { contains: query.q, mode: 'insensitive' } },
              { variant: { contains: query.q, mode: 'insensitive' } },
              { sku: { contains: query.q, mode: 'insensitive' } },
              { barcode: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.tenantTx.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.product.findMany({
          where,
          include: { category: true },
          orderBy: [{ name: 'asc' }, { brand: 'asc' }, { variant: 'asc' }, { id: 'asc' }],
          take: limit,
          skip: offset,
        }),
        tx.product.count({ where }),
      ]);
      return { items: await this.describeMany(tx, actor, rows), total, limit, offset };
    });
  }

  /** One product. 404 when it is not in this business. */
  async get(actor: LoadedAccess, productId: string): Promise<ProductCashierDto | ProductAdminDto> {
    return this.tenantTx.run(
      async (tx) => (await this.describeMany(tx, actor, [await this.load(tx, productId)]))[0]!,
    );
  }

  /** The active product with exactly this barcode (the till scans one). 404 when none. */
  async byBarcode(
    actor: LoadedAccess,
    barcode: string,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.tenantTx.run(async (tx) => {
      const row = await tx.product.findFirst({
        where: { barcode, isActive: true },
        include: { category: true },
      });
      if (!row) throw new DomainError('NOT_FOUND', 'No product has this barcode.');
      return (await this.describeMany(tx, actor, [row]))[0]!;
    });
  }

  /** Every price a product ever had, newest first, with who changed it and why. */
  async priceHistory(productId: string): Promise<PriceHistoryDto> {
    return this.tenantTx.run(async (tx) => {
      await this.load(tx, productId);
      const rows = await tx.priceHistory.findMany({
        where: { productId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      });
      const people = await tx.user.findMany({
        where: { id: { in: rows.flatMap((row) => (row.changedBy ? [row.changedBy] : [])) } },
        select: { id: true, fullName: true },
      });
      const names = new Map(people.map((person) => [person.id, person.fullName]));
      const now = this.clock.now();
      const currentId = rows.find((row) => row.effectiveFrom <= now)?.id;
      return {
        prices: rows.map((row): PriceDto => ({
          id: row.id,
          mrpPaise: row.mrpPaise,
          pricePaise: row.pricePaise,
          effectiveFrom: row.effectiveFrom.toISOString(),
          reason: row.reason,
          changedByName: row.changedBy ? (names.get(row.changedBy) ?? null) : null,
          current: row.id === currentId,
          scheduled: row.effectiveFrom > now,
        })),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------------------------

  /** Create a product together with its first price (recorded in the price history as "Initial price"). */
  async create(
    actor: LoadedAccess,
    dto: CreateProductDto,
    info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    this.assertMayTouchCost(actor, dto.purchaseCostPaise);
    try {
      return await this.tenantTx.run(async (tx) => {
        const fields = fieldsOf(dto);
        await this.checkFields(tx, fields, dto.categoryId ?? null, dto.mrpPaise, dto.pricePaise);
        await this.assertUnique(tx, fields);

        const row = await tx.product.create({
          data: {
            tenantId: actor.tenantId,
            ...columnsOf(fields),
            categoryId: dto.categoryId ?? null,
            purchaseCostPaise: dto.purchaseCostPaise ?? null,
            createdBy: actor.userId,
            prices: {
              create: {
                tenantId: actor.tenantId,
                mrpPaise: dto.mrpPaise,
                pricePaise: dto.pricePaise,
                effectiveFrom: this.clock.now(),
                changedBy: actor.userId,
                reason: 'Initial price',
              },
            },
          },
          include: { category: true },
        });
        await this.audit.write(
          tx,
          {
            action: 'product.created',
            actorUserId: actor.userId,
            entity: 'product',
            entityId: row.id,
            metadata: { name: row.name, mrpPaise: dto.mrpPaise, pricePaise: dto.pricePaise },
          },
          info,
        );
        return (await this.describeMany(tx, actor, [row]))[0]!;
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  /**
   * Replace a product's descriptive fields. Prices are not touched (see {@link changePrice}). A cost sent by someone
   * without `products.cost.read` is refused; leaving the cost out keeps the existing one.
   */
  async update(
    actor: LoadedAccess,
    productId: string,
    dto: UpdateProductDto,
    info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    this.assertMayTouchCost(actor, dto.purchaseCostPaise);
    try {
      return await this.tenantTx.run(async (tx) => {
        const before = await this.load(tx, productId);
        const fields = fieldsOf(dto);
        const prices = await this.currentPrices(tx, [productId]);
        const current = prices.get(productId);
        await this.checkFields(
          tx,
          fields,
          dto.categoryId ?? null,
          current?.mrpPaise ?? 1,
          current?.pricePaise ?? 1,
        );
        await this.assertUnique(tx, fields, productId);

        const data = {
          ...columnsOf(fields),
          categoryId: dto.categoryId ?? null,
          ...(dto.purchaseCostPaise !== undefined
            ? { purchaseCostPaise: dto.purchaseCostPaise }
            : {}),
        };
        const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
          (field) => before[field] !== data[field],
        );
        const row = await tx.product.update({
          where: { id: productId },
          data,
          include: { category: true },
        });
        if (changed.length > 0) {
          await this.audit.write(
            tx,
            {
              action: 'product.updated',
              actorUserId: actor.userId,
              entity: 'product',
              entityId: productId,
              // Field NAMES only, never values: the cost must not appear in a log that people without cost access can read.
              metadata: { changedFields: changed.join(',') },
            },
            info,
          );
        }
        return (await this.describeMany(tx, actor, [row]))[0]!;
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  /** Switch a product off or on. Products are never deleted (invoices and stock refer to them). */
  async setActive(
    actor: LoadedAccess,
    productId: string,
    active: boolean,
    info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.tenantTx.run(async (tx) => {
      const before = await this.load(tx, productId);
      if (before.isActive !== active) {
        await tx.product.update({ where: { id: productId }, data: { isActive: active } });
        await this.audit.write(
          tx,
          {
            action: active ? 'product.activated' : 'product.deactivated',
            actorUserId: actor.userId,
            entity: 'product',
            entityId: productId,
          },
          info,
        );
      }
      return (await this.describeMany(tx, actor, [await this.load(tx, productId)]))[0]!;
    });
  }

  /**
   * Change a product's price. Adds a row to the append-only price history (who, when, why); never edits an old one.
   * The new price may start now or at a later time (a scheduled change); it may not start in the past, because a past
   * price would quietly rewrite what earlier bills should have charged.
   *
   * @throws DomainError VALIDATION_FAILED for bad amounts or a past start; BUSINESS_RULE_VIOLATION when the price
   *   in force already equals the new one.
   */
  async changePrice(
    actor: LoadedAccess,
    productId: string,
    dto: ChangePriceDto,
    info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.tenantTx.run(async (tx) => {
      await this.load(tx, productId);
      const errors = priceErrors(dto.mrpPaise, dto.pricePaise);
      const now = this.clock.now();
      const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : now;
      // One minute of grace so "now" typed a moment ago is not refused.
      if (effectiveFrom.getTime() < now.getTime() - 60_000)
        errors.push({ field: 'effectiveFrom', message: 'A price cannot start in the past.' });
      failIfAny(errors);

      const current = (await this.currentPrices(tx, [productId])).get(productId);
      if (
        current &&
        current.mrpPaise === dto.mrpPaise &&
        current.pricePaise === dto.pricePaise &&
        effectiveFrom <= now
      ) {
        throw new DomainError('BUSINESS_RULE_VIOLATION', 'The product already has this price.');
      }
      await tx.priceHistory.create({
        data: {
          tenantId: actor.tenantId,
          productId,
          mrpPaise: dto.mrpPaise,
          pricePaise: dto.pricePaise,
          effectiveFrom,
          changedBy: actor.userId,
          reason: dto.reason,
        },
      });
      await this.audit.write(
        tx,
        {
          action: 'product.price_changed',
          actorUserId: actor.userId,
          entity: 'product',
          entityId: productId,
          metadata: {
            mrpPaise: dto.mrpPaise,
            pricePaise: dto.pricePaise,
            previousPricePaise: current?.pricePaise ?? null,
            effectiveFrom: effectiveFrom.toISOString(),
            reason: dto.reason,
          },
        },
        info,
      );
      return (await this.describeMany(tx, actor, [await this.load(tx, productId)]))[0]!;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Pictures
  // ---------------------------------------------------------------------------------------------

  /**
   * Save the product's picture (replaces the old one). The upload is decoded and re-encoded as WebP in two sizes, so
   * what we keep is a clean picture, never the uploaded bytes (see images/product-images.ts).
   *
   * @throws StorageValidationError (mapped to 415 or 422) for a wrong type or a file that is not really a picture.
   */
  async setImage(
    actor: LoadedAccess,
    productId: string,
    file: Buffer,
    info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    // Prove the product exists (and is ours) BEFORE spending effort on the picture.
    await this.tenantTx.run((tx) => this.load(tx, productId));
    const images = await makeProductImages(file);
    const fullKey = buildStorageKey({
      tenantId: actor.tenantId,
      category: 'product-images',
      extension: 'webp',
    });
    const thumbKey = buildStorageKey({
      tenantId: actor.tenantId,
      category: 'product-images',
      extension: 'webp',
    });
    await this.storage.put({ key: fullKey, data: images.full, contentType: 'image/webp' });
    await this.storage.put({ key: thumbKey, data: images.thumb, contentType: 'image/webp' });

    const old = await this.tenantTx.run(async (tx) => {
      const before = await this.load(tx, productId);
      await tx.product.update({
        where: { id: productId },
        data: { imageKey: fullKey, thumbKey },
      });
      await this.audit.write(
        tx,
        {
          action: 'product.image_changed',
          actorUserId: actor.userId,
          entity: 'product',
          entityId: productId,
        },
        info,
      );
      return { imageKey: before.imageKey, thumbKey: before.thumbKey };
    });
    // Delete the old files only after the new ones are saved and recorded.
    await this.deleteFiles(old.imageKey, old.thumbKey);
    return this.get(actor, productId);
  }

  /** Remove the picture. Doing it twice is fine. */
  async removeImage(actor: LoadedAccess, productId: string, info: RequestInfo): Promise<void> {
    const old = await this.tenantTx.run(async (tx) => {
      const before = await this.load(tx, productId);
      if (!before.imageKey) return null;
      await tx.product.update({
        where: { id: productId },
        data: { imageKey: null, thumbKey: null },
      });
      await this.audit.write(
        tx,
        {
          action: 'product.image_removed',
          actorUserId: actor.userId,
          entity: 'product',
          entityId: productId,
        },
        info,
      );
      return { imageKey: before.imageKey, thumbKey: before.thumbKey };
    });
    if (old) await this.deleteFiles(old.imageKey, old.thumbKey);
  }

  /**
   * The picture, ready to send. The storage key comes from this business's own product row (row-level security), never
   * from the request, so nobody can ask for another business's file.
   *
   * @throws DomainError NOT_FOUND when the product has no picture.
   */
  async openImage(
    productId: string,
    size: 'full' | 'thumb',
  ): Promise<{ file: StreamableFile; size: number }> {
    const row = await this.tenantTx.run((tx) => this.load(tx, productId));
    const key = size === 'thumb' ? row.thumbKey : row.imageKey;
    if (!key) throw new DomainError('NOT_FOUND', 'This product has no picture.');
    const opened = await this.storage.get(key);
    return { file: new StreamableFile(opened.stream), size: opened.size };
  }

  // ---------------------------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------------------------

  /** One product of this business, or 404 (another business's product is invisible: row-level security). */
  private async load(tx: TenantTransaction, productId: string): Promise<ProductRow> {
    const row = await tx.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'This product does not exist.');
    return row;
  }

  /** Only people with products.cost.read may send a cost. */
  private assertMayTouchCost(actor: LoadedAccess, cost: number | null | undefined): void {
    if (cost !== undefined && !canSeeCost(actor)) {
      throw new DomainError('FORBIDDEN', 'You do not have permission to set the purchase cost.');
    }
  }

  /** The rules that need the database: tax details, category, and the shared field and price rules. */
  private async checkFields(
    tx: TenantTransaction,
    fields: ProductFields,
    categoryId: string | null,
    mrpPaise: number,
    pricePaise: number,
  ): Promise<void> {
    const tenant = await tx.tenant.findFirstOrThrow({ select: { gstin: true } });
    const errors = [
      ...productFieldErrors(fields, tenant.gstin !== null),
      ...priceErrors(mrpPaise, pricePaise),
    ];
    if (categoryId && !(await tx.productCategory.findUnique({ where: { id: categoryId } }))) {
      errors.push({ field: 'categoryId', message: 'Choose a category from the list.' });
    }
    failIfAny(errors);
  }

  /** Name the exact field that clashes with another product (barcode, SKU, or name + brand + variant). */
  private async assertUnique(
    tx: TenantTransaction,
    fields: ProductFields,
    exceptId?: string,
  ): Promise<void> {
    const others = { id: exceptId ? { not: exceptId } : undefined };
    const clash = async (where: Prisma.ProductWhereInput): Promise<boolean> =>
      (await tx.product.findFirst({ where: { ...others, ...where }, select: { id: true } })) !==
      null;

    const errors: FieldError[] = [];
    if (fields.barcode && (await clash({ barcode: fields.barcode })))
      errors.push({ field: 'barcode', message: 'Another product already has this barcode.' });
    if (fields.sku && (await clash({ sku: fields.sku })))
      errors.push({ field: 'sku', message: 'Another product already has this SKU.' });
    if (
      await clash({
        name: { equals: fields.name, mode: 'insensitive' },
        brand: { equals: fields.brand, mode: 'insensitive' },
        variant: { equals: fields.variant, mode: 'insensitive' },
      })
    )
      errors.push({
        field: 'name',
        message: 'A product with this name, brand and variant already exists.',
      });
    if (errors.length > 0) {
      throw new DomainError('CONFLICT', 'This product clashes with an existing one.', errors);
    }
  }

  /** The price in force now for each product (newest row that has started; ties broken by when it was recorded). */
  private async currentPrices(
    tx: TenantTransaction,
    productIds: string[],
  ): Promise<Map<string, CurrentPrice>> {
    if (productIds.length === 0) return new Map();
    const rows = await tx.priceHistory.findMany({
      where: { productId: { in: productIds }, effectiveFrom: { lte: this.clock.now() } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const prices = new Map<string, CurrentPrice>();
    for (const row of rows) {
      if (!prices.has(row.productId)) {
        prices.set(row.productId, { mrpPaise: row.mrpPaise, pricePaise: row.pricePaise });
      }
    }
    return prices;
  }

  /** Turn rows into the response type this caller is allowed to see (cashier shape, or admin shape with cost). */
  private async describeMany(
    tx: TenantTransaction,
    actor: LoadedAccess,
    rows: ProductRow[],
  ): Promise<Array<ProductCashierDto | ProductAdminDto>> {
    const prices = await this.currentPrices(
      tx,
      rows.map((row) => row.id),
    );
    const withCost = canSeeCost(actor);
    return rows.map((row) => {
      const price = prices.get(row.id) ?? { mrpPaise: 0, pricePaise: 0 };
      const base: ProductCashierDto = {
        id: row.id,
        name: row.name,
        brand: row.brand,
        variant: row.variant,
        categoryId: row.categoryId,
        categoryName: row.category?.name ?? null,
        sku: row.sku,
        barcode: row.barcode,
        hsn: row.hsn,
        gstRateBp: row.gstRateBp,
        mrpPaise: price.mrpPaise,
        pricePaise: price.pricePaise,
        hasImage: row.imageKey !== null,
        isActive: row.isActive,
      };
      if (!withCost) return base;
      const cost = row.purchaseCostPaise;
      return {
        ...base,
        purchaseCostPaise: cost,
        marginBp: cost === null ? null : marginBp(price.pricePaise, cost),
        belowCost: cost !== null && price.pricePaise < cost,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  private async deleteFiles(...keys: Array<string | null>): Promise<void> {
    for (const key of keys) if (key) await this.storage.delete(key);
  }
}

/** The descriptive fields of a request, with blanks turned into the stored form. */
export function fieldsOf(dto: {
  name: string;
  brand?: string;
  variant?: string;
  sku?: string | null;
  barcode?: string | null;
  hsn?: string | null;
  gstRateBp?: number | null;
}): ProductFields {
  return {
    name: dto.name,
    brand: dto.brand ?? '',
    variant: dto.variant ?? '',
    sku: dto.sku ?? null,
    barcode: dto.barcode ?? null,
    hsn: dto.hsn ?? null,
    gstRateBp: dto.gstRateBp ?? null,
  };
}

/** The database columns the descriptive fields fill. */
export function columnsOf(fields: ProductFields) {
  return {
    name: fields.name,
    brand: fields.brand,
    variant: fields.variant,
    sku: fields.sku,
    barcode: fields.barcode,
    hsn: fields.hsn,
    gstRateBp: fields.gstRateBp,
  };
}

/** The database's unique indexes stop two requests that race past the checks; say so in plain words. */
export function translateDuplicate(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new DomainError(
      'CONFLICT',
      'Another product already has this barcode, SKU, or name, brand and variant.',
    );
  }
  return error;
}

/** Describe a category for the API. */
export function toCategoryDto(row: ProductCategory): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    defaultHsn: row.defaultHsn,
    defaultGstRateBp: row.defaultGstRateBp,
  };
}
