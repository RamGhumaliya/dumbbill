import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LoadedAccess } from '../permissions/access.service';
import { BranchScope } from '../permissions/branch-scope';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { canSeeCost } from '../catalogue/products.service';
import { wacPaise } from './domain/costing';
import {
  AdjustStockDto,
  AlertsQueryDto,
  LedgerQueryDto,
  ListStockQueryDto,
  SetThresholdDto,
  WriteOffDto,
} from './dto/inventory-requests.dto';
import {
  AlertsDto,
  ExpiryAlertDto,
  LedgerEntryAdminDto,
  LedgerEntryDto,
  LedgerListDto,
  RebuildDto,
  StockChangeDto,
  StockListDto,
  StockRowAdminDto,
  StockRowCashierDto,
  ThresholdDto,
  VerifyDto,
  VerifyProblemDto,
} from './dto/inventory-responses.dto';
import { StockEngine, toNumber } from './stock-engine';
import { dateOnly, todayInIndia, usableBranch } from './support';

/**
 * Stock: levels, the ledger, counts and write-offs, low-stock levels, expiry alerts, and the checks that prove the books
 * add up (US-STK-01, US-STK-02).
 *
 * Who sees what: quantities are visible to anyone who can read products (the till needs availability). Average cost, value
 * and the cost of each movement exist only in the `...AdminDto` types, returned only to people with `products.cost.read`.
 * Every branch-bound call also checks the person may use that branch (row-level security only separates businesses).
 *
 * Every change goes through the StockEngine; this service never edits a level or a ledger row directly.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly engine: StockEngine,
    private readonly idempotency: IdempotencyService,
    private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  /** Every product with how many a branch holds. Products never stocked show 0. */
  async levels(actor: LoadedAccess, query: ListStockQueryDto): Promise<StockListDto> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    return this.tenantTx.run(async (tx) => {
      const branch = await this.readableBranch(tx, actor, query.branchId);
      const thresholds = await tx.stockThreshold.findMany({ where: { branchId: branch.id } });
      const minByProduct = new Map(thresholds.map((row) => [row.productId, row.minQty]));

      // "Low only" starts from the products that have a level set, then keeps those at or below it.
      let lowIds: string[] | undefined;
      if (query.lowOnly) {
        const levels = await tx.stockLevel.findMany({
          where: { branchId: branch.id, productId: { in: [...minByProduct.keys()] } },
        });
        const qtyByProduct = new Map(levels.map((level) => [level.productId, level.qty]));
        lowIds = [...minByProduct.entries()]
          .filter(([productId, min]) => min > 0 && (qtyByProduct.get(productId) ?? 0) <= min)
          .map(([productId]) => productId);
      }

      const where: Prisma.ProductWhereInput = {
        isActive: true,
        ...(lowIds ? { id: { in: lowIds } } : {}),
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
      const [products, total] = await Promise.all([
        tx.product.findMany({
          where,
          orderBy: [{ name: 'asc' }, { brand: 'asc' }, { variant: 'asc' }, { id: 'asc' }],
          take: limit,
          skip: offset,
        }),
        tx.product.count({ where }),
      ]);
      const levels = await tx.stockLevel.findMany({
        where: { branchId: branch.id, productId: { in: products.map((product) => product.id) } },
      });
      const levelByProduct = new Map(levels.map((level) => [level.productId, level]));
      const withCost = canSeeCost(actor);

      const items = products.map((product) => {
        const level = levelByProduct.get(product.id);
        const qty = level?.qty ?? 0;
        const min = minByProduct.get(product.id) ?? null;
        const base: StockRowCashierDto = {
          productId: product.id,
          productName: product.name,
          brand: product.brand,
          variant: product.variant,
          barcode: product.barcode,
          qty,
          minQty: min,
          isLow: min !== null && min > 0 && qty <= min,
        };
        if (!withCost) return base;
        const position = { qty, valuePaise: level ? toNumber(level.valuePaise) : 0 };
        const admin: StockRowAdminDto = {
          ...base,
          wacPaise: wacPaise(position),
          valuePaise: position.valuePaise,
        };
        return admin;
      });
      return { branchId: branch.id, items, total, limit, offset };
    });
  }

  /** The ledger of a branch (optionally one product or one kind of movement), newest first. */
  async ledger(actor: LoadedAccess, query: LedgerQueryDto): Promise<LedgerListDto> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    return this.tenantTx.run(async (tx) => {
      const branch = await this.readableBranch(tx, actor, query.branchId);
      const where: Prisma.StockLedgerWhereInput = {
        branchId: branch.id,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.type ? { type: query.type } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.stockLedger.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
        }),
        tx.stockLedger.count({ where }),
      ]);
      const [products, batches, people] = await Promise.all([
        tx.product.findMany({ where: { id: { in: rows.map((row) => row.productId) } } }),
        tx.stockBatch.findMany({
          where: { id: { in: rows.flatMap((row) => (row.batchId ? [row.batchId] : [])) } },
        }),
        tx.user.findMany({
          where: { id: { in: rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])) } },
          select: { id: true, fullName: true },
        }),
      ]);
      const productName = new Map(products.map((product) => [product.id, product.name]));
      const batchById = new Map(batches.map((batch) => [batch.id, batch]));
      const personName = new Map(people.map((person) => [person.id, person.fullName]));
      const withCost = canSeeCost(actor);

      const items = rows.map((row) => {
        const base: LedgerEntryDto = {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          type: row.type,
          productId: row.productId,
          productName: productName.get(row.productId) ?? '',
          qtyDelta: row.qtyDelta,
          qtyAfter: row.qtyAfter,
          batchNo: row.batchId ? (batchById.get(row.batchId)?.batchNo ?? null) : null,
          expiryDate: row.batchId ? dateOnly(batchById.get(row.batchId)?.expiryDate ?? null) : null,
          refType: row.refType,
          refId: row.refId,
          reason: row.reason,
          note: row.note,
          createdByName: row.createdBy ? (personName.get(row.createdBy) ?? null) : null,
        };
        if (!withCost) return base;
        const admin: LedgerEntryAdminDto = {
          ...base,
          unitCostPaise: row.unitCostPaise,
          valueDeltaPaise: toNumber(row.valueDeltaPaise),
          wacAfterPaise: row.wacAfterPaise,
          valueAfterPaise: toNumber(row.valueAfterPaise),
        };
        return admin;
      });
      return { items, total, limit, offset };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Counts and write-offs
  // ---------------------------------------------------------------------------------------------

  /**
   * "I counted this many": set the stock to the count and record the difference with a reason (journey J5).
   * A lower count removes units at the average cost (from the batches that expire first, or a named batch); a higher count
   * adds units at the current average cost. The audit entry records the quantity before and after.
   *
   * @throws DomainError BUSINESS_RULE_VIOLATION when the count already matches the books; NOT_FOUND, FORBIDDEN.
   */
  async adjust(
    actor: LoadedAccess,
    dto: AdjustStockDto,
    idempotencyKey: string | undefined,
    info: RequestInfo,
  ): Promise<{ status: number; body: StockChangeDto; replayed: boolean }> {
    // A cost typed into a count becomes the average cost of the found units, so it is cost data like any other:
    // only people allowed to set cost may send one (same rule as creating a product).
    if (dto.unitCostPaise !== undefined && !canSeeCost(actor)) {
      throw new DomainError('FORBIDDEN', 'You do not have permission to set a cost.');
    }
    return this.tenantTx.run((tx) =>
      this.idempotency.run(tx, actor.tenantId, 'stock.adjust', idempotencyKey, dto, async () => {
        const branch = await usableBranch(tx, actor, dto.branchId);
        const product = await tx.product.findUnique({ where: { id: dto.productId } });
        if (!product) throw new DomainError('NOT_FOUND', 'This product does not exist.');

        await this.engine.lockPositions(tx, actor.tenantId, branch.id, [product.id]);
        const before = await this.engine.position(tx, branch.id, product.id);
        const delta = dto.countedQty - before.qty;
        if (delta === 0) {
          throw new DomainError(
            'BUSINESS_RULE_VIOLATION',
            'The count matches what the books already say. Nothing to change.',
          );
        }
        const context = {
          tenantId: actor.tenantId,
          userId: actor.userId,
          refType: 'ADJUSTMENT',
          reason: dto.reason,
          ...(dto.note ? { note: dto.note } : {}),
        };
        if (delta < 0) {
          await this.engine.remove(tx, context, {
            branchId: branch.id,
            productId: product.id,
            qty: -delta,
            type: 'ADJUSTMENT_OUT',
            batchId: dto.batchId,
          });
        } else {
          // Found units are worth the current average; with no average yet, what the caller says or the product's own
          // cost; failing that, nothing (the next purchase puts the average right).
          const average = wacPaise(before);
          const unit =
            average > 0 ? average : (dto.unitCostPaise ?? product.purchaseCostPaise ?? 0);
          await this.engine.receive(tx, context, {
            branchId: branch.id,
            productId: product.id,
            qty: delta,
            valuePaise: delta * unit,
            type: 'ADJUSTMENT_IN',
            batch: dto.batchId ? { batchId: dto.batchId } : {},
          });
        }
        await this.audit.write(
          tx,
          {
            action: 'stock.adjusted',
            actorUserId: actor.userId,
            actorRole: actor.roleName,
            entity: 'product',
            entityId: product.id,
            metadata: { branchId: branch.id, reason: dto.reason },
            before: { qty: before.qty },
            after: { qty: dto.countedQty },
          },
          info,
        );
        return {
          status: 201,
          body: {
            productId: product.id,
            branchId: branch.id,
            qtyBefore: before.qty,
            qtyAfter: dto.countedQty,
          },
        };
      }),
    );
  }

  /**
   * Write off an expired batch (ledger type EXPIRY_WRITE_OFF). Only a batch whose expiry date has PASSED may be written off
   * this way; goods that are merely damaged use a stock count with the reason DAMAGE.
   *
   * @throws DomainError BUSINESS_RULE_VIOLATION when the batch has not expired; INSUFFICIENT_STOCK for a quantity above what is left.
   */
  async writeOff(
    actor: LoadedAccess,
    dto: WriteOffDto,
    idempotencyKey: string | undefined,
    info: RequestInfo,
  ): Promise<{ status: number; body: StockChangeDto; replayed: boolean }> {
    return this.tenantTx.run((tx) =>
      this.idempotency.run(tx, actor.tenantId, 'stock.write-off', idempotencyKey, dto, async () => {
        const branch = await usableBranch(tx, actor, dto.branchId);
        const batch = await tx.stockBatch.findFirst({
          where: { id: dto.batchId, branchId: branch.id },
        });
        if (!batch) throw new DomainError('NOT_FOUND', 'This batch does not exist at this branch.');
        const today = todayInIndia(this.clock);
        if (!batch.expiryDate || (dateOnly(batch.expiryDate) as string) >= today) {
          throw new DomainError(
            'BUSINESS_RULE_VIOLATION',
            'This batch has not expired. For damaged goods, use a stock count with the reason Damage.',
          );
        }
        await this.engine.lockPositions(tx, actor.tenantId, branch.id, [batch.productId]);
        const fresh = await tx.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
        const qty = dto.qty ?? fresh.qtyRemaining;
        if (qty <= 0)
          throw new DomainError('BUSINESS_RULE_VIOLATION', 'Nothing is left in this batch.');
        const before = await this.engine.position(tx, branch.id, batch.productId);
        await this.engine.remove(
          tx,
          {
            tenantId: actor.tenantId,
            userId: actor.userId,
            refType: 'WRITE_OFF',
            refId: batch.id,
            reason: 'EXPIRED',
            ...(dto.note ? { note: dto.note } : {}),
          },
          {
            branchId: branch.id,
            productId: batch.productId,
            qty,
            type: 'EXPIRY_WRITE_OFF',
            batchId: batch.id,
          },
        );
        await this.audit.write(
          tx,
          {
            action: 'stock.expiry_written_off',
            actorUserId: actor.userId,
            actorRole: actor.roleName,
            entity: 'product',
            entityId: batch.productId,
            metadata: { branchId: branch.id, batchId: batch.id, batchNo: batch.batchNo },
            before: { qty: before.qty },
            after: { qty: before.qty - qty },
          },
          info,
        );
        return {
          status: 201,
          body: {
            productId: batch.productId,
            branchId: branch.id,
            qtyBefore: before.qty,
            qtyAfter: before.qty - qty,
          },
        };
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Alerts and settings
  // ---------------------------------------------------------------------------------------------

  /** Set (or change) the low-stock level of a product at a branch. 0 switches the alert off. */
  async setThreshold(
    actor: LoadedAccess,
    dto: SetThresholdDto,
    info: RequestInfo,
  ): Promise<ThresholdDto> {
    return this.tenantTx.run(async (tx) => {
      const branch = await usableBranch(tx, actor, dto.branchId);
      const product = await tx.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new DomainError('NOT_FOUND', 'This product does not exist.');
      await tx.stockThreshold.upsert({
        where: { branchId_productId: { branchId: branch.id, productId: product.id } },
        create: {
          tenantId: actor.tenantId,
          branchId: branch.id,
          productId: product.id,
          minQty: dto.minQty,
        },
        update: { minQty: dto.minQty },
      });
      await this.audit.write(
        tx,
        {
          action: 'stock.threshold_set',
          actorUserId: actor.userId,
          actorRole: actor.roleName,
          entity: 'product',
          entityId: product.id,
          metadata: { branchId: branch.id, minQty: dto.minQty },
        },
        info,
      );
      return { branchId: branch.id, productId: product.id, minQty: dto.minQty };
    });
  }

  async settings(): Promise<{ nearExpiryDays: number }> {
    const tenant = await this.tenantTx.run((tx) =>
      tx.tenant.findFirstOrThrow({ select: { nearExpiryDays: true } }),
    );
    return { nearExpiryDays: tenant.nearExpiryDays };
  }

  async updateSettings(
    actor: LoadedAccess,
    nearExpiryDays: number,
    info: RequestInfo,
  ): Promise<{ nearExpiryDays: number }> {
    return this.tenantTx.run(async (tx) => {
      const before = await tx.tenant.findFirstOrThrow({
        select: { id: true, nearExpiryDays: true },
      });
      await tx.tenant.update({ where: { id: before.id }, data: { nearExpiryDays } });
      await this.audit.write(
        tx,
        {
          action: 'stock.settings_changed',
          actorUserId: actor.userId,
          actorRole: actor.roleName,
          entity: 'tenant',
          entityId: before.id,
          before: { nearExpiryDays: before.nearExpiryDays },
          after: { nearExpiryDays },
        },
        info,
      );
      return { nearExpiryDays };
    });
  }

  /**
   * What needs attention: products at or below their low-stock level, batches that expire within the window, and batches
   * already expired that still hold units. Only branches the person may use.
   */
  async alerts(actor: LoadedAccess, query: AlertsQueryDto): Promise<AlertsDto> {
    const scope = new BranchScope(actor);
    return this.tenantTx.run(async (tx) => {
      // A named branch is checked like everywhere else: another business's branch is a 404, one this person's role does
      // not cover is a 403. (Quietly answering "nothing to report" would hide the difference and mislead a typo.)
      if (query.branchId) await this.readableBranch(tx, actor, query.branchId);
      const branchWhere = query.branchId ?? scope.filter();
      const tenant = await tx.tenant.findFirstOrThrow({ select: { nearExpiryDays: true } });
      const today = todayInIndia(this.clock);
      const horizon = new Date(`${today}T00:00:00.000Z`);
      horizon.setUTCDate(horizon.getUTCDate() + tenant.nearExpiryDays);

      // Expired and soon-to-expire batches are capped separately: a pile of old expired batches must not push the
      // ones about to expire off the list.
      const batchWhere = { branchId: branchWhere, qtyRemaining: { gt: 0 } };
      const todayDate = new Date(`${today}T00:00:00.000Z`);
      const [thresholds, expiredBatches, nearBatches, branches] = await Promise.all([
        tx.stockThreshold.findMany({ where: { branchId: branchWhere, minQty: { gt: 0 } } }),
        tx.stockBatch.findMany({
          where: { ...batchWhere, expiryDate: { not: null, lt: todayDate } },
          orderBy: [{ expiryDate: 'desc' }, { id: 'asc' }],
          take: 300,
        }),
        tx.stockBatch.findMany({
          where: { ...batchWhere, expiryDate: { gte: todayDate, lte: horizon } },
          orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
          take: 300,
        }),
        tx.branch.findMany(),
      ]);
      const batches = [...expiredBatches, ...nearBatches];
      const levels = await tx.stockLevel.findMany({
        where: {
          productId: { in: thresholds.map((row) => row.productId) },
          branchId: { in: thresholds.map((row) => row.branchId) },
        },
      });
      const qtyOf = new Map(
        levels.map((level) => [`${level.branchId}:${level.productId}`, level.qty]),
      );
      const products = await tx.product.findMany({
        where: {
          id: {
            in: [...thresholds.map((row) => row.productId), ...batches.map((row) => row.productId)],
          },
        },
      });
      const productName = new Map(products.map((product) => [product.id, product.name]));
      const productActive = new Map(products.map((product) => [product.id, product.isActive]));
      const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));

      const lowStock = thresholds
        .map((row) => ({ row, qty: qtyOf.get(`${row.branchId}:${row.productId}`) ?? 0 }))
        .filter(({ row, qty }) => qty <= row.minQty && productActive.get(row.productId) === true)
        .map(({ row, qty }) => ({
          branchId: row.branchId,
          branchName: branchName.get(row.branchId) ?? '',
          productId: row.productId,
          productName: productName.get(row.productId) ?? '',
          qty,
          minQty: row.minQty,
        }))
        .sort((a, b) => a.qty - b.qty || a.productName.localeCompare(b.productName));

      const msPerDay = 86_400_000;
      const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();
      const toAlert = (batch: (typeof batches)[number]): ExpiryAlertDto => ({
        batchId: batch.id,
        branchId: batch.branchId,
        branchName: branchName.get(batch.branchId) ?? '',
        productId: batch.productId,
        productName: productName.get(batch.productId) ?? '',
        batchNo: batch.batchNo,
        expiryDate: dateOnly(batch.expiryDate) as string,
        qtyRemaining: batch.qtyRemaining,
        daysLeft: Math.round(((batch.expiryDate as Date).getTime() - todayMs) / msPerDay),
      });
      const alerts = batches.map(toAlert);
      return {
        nearExpiryDays: tenant.nearExpiryDays,
        lowStock,
        nearExpiry: alerts.filter((alert) => alert.daysLeft >= 0),
        expired: alerts.filter((alert) => alert.daysLeft < 0),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Proving the books add up
  // ---------------------------------------------------------------------------------------------

  /**
   * The nightly-style check (US-STK-01): for every product at every branch, the stock level must equal the sum of its
   * ledger rows (quantity AND value), and the batches must add up to the level. Reads only; changes nothing.
   */
  async verify(): Promise<VerifyDto> {
    return this.tenantTx.run(async (tx) => {
      const found = await this.compare(tx);
      return {
        ok: found.problems.length === 0,
        checkedPositions: found.checked,
        problems: found.problems,
      };
    });
  }

  /**
   * Put every stock level and batch right from the ledger (the ledger is the truth; levels are a projection). Used after a
   * fault; audited. Changes nothing when everything already agrees.
   */
  async rebuild(actor: LoadedAccess, info: RequestInfo): Promise<RebuildDto> {
    return this.tenantTx.run(async (tx) => {
      const sums = await this.ledgerSums(tx);
      let levelsFixed = 0;
      let batchesFixed = 0;
      const levels = await tx.stockLevel.findMany();
      for (const level of levels) {
        const sum = sums.positions.get(`${level.branchId}:${level.productId}`) ?? {
          qty: 0,
          value: 0n,
        };
        if (level.qty !== sum.qty || level.valuePaise !== sum.value) {
          await tx.stockLevel.update({
            where: { branchId_productId: { branchId: level.branchId, productId: level.productId } },
            data: { qty: sum.qty, valuePaise: sum.value, version: { increment: 1 } },
          });
          levelsFixed += 1;
        }
      }
      const batches = await tx.stockBatch.findMany();
      for (const batch of batches) {
        const qty = sums.batches.get(batch.id) ?? 0;
        if (batch.qtyRemaining !== qty) {
          await tx.stockBatch.update({ where: { id: batch.id }, data: { qtyRemaining: qty } });
          batchesFixed += 1;
        }
      }
      await this.audit.write(
        tx,
        {
          action: 'stock.rebuilt',
          actorUserId: actor.userId,
          actorRole: actor.roleName,
          entity: 'stock',
          metadata: { levelsFixed, batchesFixed },
        },
        info,
      );
      return { levelsFixed, batchesFixed };
    });
  }

  // ---------------------------------------------------------------------------------------------

  /** A branch the person may read stock of (it may be switched off: history stays readable). */
  private async readableBranch(tx: TenantTransaction, actor: LoadedAccess, branchId: string) {
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new DomainError('NOT_FOUND', 'This branch does not exist.');
    new BranchScope(actor).assert(branch.id);
    return branch;
  }

  /** The totals the ledger implies, per position and per batch. */
  private async ledgerSums(tx: TenantTransaction) {
    const [byPosition, byBatch] = await Promise.all([
      tx.stockLedger.groupBy({
        by: ['branchId', 'productId'],
        _sum: { qtyDelta: true, valueDeltaPaise: true },
      }),
      tx.stockLedger.groupBy({ by: ['batchId'], _sum: { qtyDelta: true } }),
    ]);
    const positions = new Map<string, { qty: number; value: bigint }>();
    for (const row of byPosition) {
      positions.set(`${row.branchId}:${row.productId}`, {
        qty: row._sum.qtyDelta ?? 0,
        value: row._sum.valueDeltaPaise ?? 0n,
      });
    }
    const batches = new Map<string, number>();
    for (const row of byBatch) if (row.batchId) batches.set(row.batchId, row._sum.qtyDelta ?? 0);
    return { positions, batches };
  }

  private async compare(
    tx: TenantTransaction,
  ): Promise<{ checked: number; problems: VerifyProblemDto[] }> {
    const sums = await this.ledgerSums(tx);
    const [levels, batches] = await Promise.all([
      tx.stockLevel.findMany(),
      tx.stockBatch.findMany(),
    ]);
    const problems: VerifyProblemDto[] = [];
    const seen = new Set<string>();

    for (const level of levels) {
      const key = `${level.branchId}:${level.productId}`;
      seen.add(key);
      const sum = sums.positions.get(key) ?? { qty: 0, value: 0n };
      if (level.qty !== sum.qty) {
        problems.push({
          branchId: level.branchId,
          productId: level.productId,
          problem: `Stock level says ${level.qty} but the ledger adds up to ${sum.qty}.`,
        });
      } else if (level.valuePaise !== sum.value) {
        problems.push({
          branchId: level.branchId,
          productId: level.productId,
          problem: 'Stock value does not match the ledger.',
        });
      }
    }
    // Ledger rows for a position that has no level at all.
    for (const [key, sum] of sums.positions) {
      if (!seen.has(key) && (sum.qty !== 0 || sum.value !== 0n)) {
        const [branchId, productId] = key.split(':') as [string, string];
        problems.push({
          branchId,
          productId,
          problem: 'The ledger has movements but there is no stock level.',
        });
      }
    }
    // Batches must add up to the level of their position.
    const batchTotals = new Map<string, number>();
    for (const batch of batches) {
      const key = `${batch.branchId}:${batch.productId}`;
      batchTotals.set(key, (batchTotals.get(key) ?? 0) + batch.qtyRemaining);
      const expected = sums.batches.get(batch.id) ?? 0;
      if (batch.qtyRemaining !== expected) {
        problems.push({
          branchId: batch.branchId,
          productId: batch.productId,
          problem: `A batch says ${batch.qtyRemaining} but the ledger adds up to ${expected}.`,
        });
      }
    }
    for (const level of levels) {
      const total = batchTotals.get(`${level.branchId}:${level.productId}`) ?? 0;
      if (total !== level.qty) {
        problems.push({
          branchId: level.branchId,
          productId: level.productId,
          problem: `The batches add up to ${total} but the stock level says ${level.qty}.`,
        });
      }
    }
    return { checked: levels.length, problems };
  }
}
