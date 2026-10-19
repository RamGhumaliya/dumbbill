import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { FieldError } from '../../common/errors/domain-error';
import { uuid7 } from '../../common/uuid7';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { LoadedAccess } from '../permissions/access.service';
import { TenantTx } from '../tenancy/tenant-tx.service';
import { CsvFormatError } from './domain/csv';
import { ImportDraft, ImportRow, parseProductImport } from './domain/import-parser';
import { identityKey } from './domain/product-rules';
import { ImportReportDto } from './dto/catalogue-responses.dto';
import { canSeeCost } from './products.service';

/**
 * Bulk product import from a CSV file (US-PROD-01): every row is checked, the good rows are saved, and each bad row is
 * reported with the exact problem, so the owner can fix the file and import only what failed.
 *
 * Checks, in order:
 *  1. the file's own shape and every row's values (domain/import-parser.ts, no database);
 *  2. the cost column, which only people with `products.cost.read` may use;
 *  3. clashes with products that already exist (barcode, SKU, name + brand + variant).
 *
 * Categories named in the file are matched ignoring case; ones that do not exist yet are created, and listed in the
 * report so a typo is visible. A "check only" run (`dryRun`) does all the checks and saves nothing.
 */
@Injectable()
export class ProductImportService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async importCsv(
    actor: LoadedAccess,
    csv: string,
    dryRun: boolean,
    info: RequestInfo,
  ): Promise<ImportReportDto> {
    return this.tenantTx.run(async (tx) => {
      const tenant = await tx.tenant.findFirstOrThrow({ select: { gstin: true } });
      let parsed;
      try {
        parsed = parseProductImport(csv, tenant.gstin !== null);
      } catch (error) {
        if (error instanceof CsvFormatError) {
          return emptyReport(dryRun, [`The file is not valid CSV: ${error.message}`]);
        }
        throw error;
      }
      if (parsed.fileErrors.length > 0) {
        return { ...emptyReport(dryRun, parsed.fileErrors), ignoredColumns: parsed.ignoredColumns };
      }

      // Cost is confidential: a person without access may not slip it in through a file.
      const mayImportCost = canSeeCost(actor);
      const rows: ImportRow[] = parsed.rows.map((row) =>
        row.draft && row.draft.purchaseCostPaise !== null && !mayImportCost
          ? {
              rowNumber: row.rowNumber,
              errors: [{ field: 'cost', message: 'You do not have permission to import costs.' }],
            }
          : row,
      );

      // Clashes with what is already in the catalogue.
      const drafts = rows.flatMap((row) => (row.draft ? [row.draft] : []));
      const [byBarcode, bySku, existing, categories] = await Promise.all([
        tx.product.findMany({
          where: { barcode: { in: drafts.flatMap((d) => (d.barcode ? [d.barcode] : [])) } },
          select: { barcode: true },
        }),
        tx.product.findMany({
          where: {
            sku: { in: drafts.flatMap((d) => (d.sku ? [d.sku] : [])), mode: 'insensitive' },
          },
          select: { sku: true },
        }),
        tx.product.findMany({ select: { name: true, brand: true, variant: true } }),
        tx.productCategory.findMany(),
      ]);
      const takenBarcodes = new Set(byBarcode.map((p) => p.barcode));
      const takenSkus = new Set(bySku.map((p) => p.sku?.toLowerCase()));
      const takenIdentities = new Set(existing.map((p) => identityKey(p)));

      const accepted: ImportDraft[] = [];
      const failed: Array<{ rowNumber: number; errors: FieldError[] }> = [];
      for (const row of rows) {
        const errors = [...row.errors];
        const draft = row.draft;
        if (draft && errors.length === 0) {
          if (draft.barcode && takenBarcodes.has(draft.barcode))
            errors.push({ field: 'barcode', message: 'Another product already has this barcode.' });
          if (draft.sku && takenSkus.has(draft.sku.toLowerCase()))
            errors.push({ field: 'sku', message: 'Another product already has this SKU.' });
          if (takenIdentities.has(identityKey(draft)))
            errors.push({
              field: 'name',
              message: 'A product with this name, brand and variant already exists.',
            });
        }
        if (errors.length > 0 || !draft) failed.push({ rowNumber: row.rowNumber, errors });
        else accepted.push(draft);
      }

      // Categories: reuse by name (ignoring case), create the rest.
      const categoryIds = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
      const newCategoryNames = [
        ...new Map(
          accepted.flatMap((d) =>
            d.categoryName && !categoryIds.has(d.categoryName.toLowerCase())
              ? [[d.categoryName.toLowerCase(), d.categoryName] as const]
              : [],
          ),
        ).values(),
      ];

      if (!dryRun && accepted.length > 0) {
        for (const name of newCategoryNames) {
          const made = await tx.productCategory.create({
            data: { tenantId: actor.tenantId, name },
          });
          categoryIds.set(name.toLowerCase(), made.id);
        }
        // Ids are made here so products and their first prices go in with two bulk inserts instead of one per row.
        const now = this.clock.now();
        const withIds = accepted.map((draft) => ({ draft, id: uuid7() }));
        await tx.product.createMany({
          data: withIds.map(({ draft, id }) => ({
            id,
            tenantId: actor.tenantId,
            name: draft.name,
            brand: draft.brand,
            variant: draft.variant,
            sku: draft.sku,
            barcode: draft.barcode,
            hsn: draft.hsn,
            gstRateBp: draft.gstRateBp,
            purchaseCostPaise: draft.purchaseCostPaise,
            categoryId: draft.categoryName
              ? (categoryIds.get(draft.categoryName.toLowerCase()) ?? null)
              : null,
            createdBy: actor.userId,
          })),
        });
        await tx.priceHistory.createMany({
          data: withIds.map(({ draft, id }) => ({
            tenantId: actor.tenantId,
            productId: id,
            mrpPaise: draft.mrpPaise,
            pricePaise: draft.pricePaise,
            effectiveFrom: now,
            changedBy: actor.userId,
            reason: 'Initial price (CSV import)',
          })),
        });
        await this.audit.write(
          tx,
          {
            action: 'product.imported',
            actorUserId: actor.userId,
            entity: 'product',
            metadata: { created: accepted.length, failed: failed.length },
          },
          info,
        );
      }

      return {
        dryRun,
        fileErrors: [],
        ignoredColumns: parsed.ignoredColumns,
        totalRows: rows.length,
        createdCount: accepted.length,
        failedCount: failed.length,
        categoriesCreated: newCategoryNames,
        failedRows: failed,
      };
    });
  }
}

function emptyReport(dryRun: boolean, fileErrors: string[]): ImportReportDto {
  return {
    dryRun,
    fileErrors,
    ignoredColumns: [],
    totalRows: 0,
    createdCount: 0,
    failedCount: 0,
    categoriesCreated: [],
    failedRows: [],
  };
}
