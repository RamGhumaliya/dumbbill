import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { DomainError, FieldError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { allocateExtraCost, landedLineValue, unitCostOf } from '../inventory/domain/costing';
import { StockEngine } from '../inventory/stock-engine';
import {
  dateOnly,
  parseDateOnly,
  todayInIndia,
  usableBranch,
  usableProducts,
} from '../inventory/support';
import { LoadedAccess } from '../permissions/access.service';
import { BranchScope } from '../permissions/branch-scope';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { CreatePurchaseDto, ListPurchasesQueryDto } from './dto/purchasing-requests.dto';
import {
  PurchaseDto,
  PurchaseLineDetailDto,
  PurchaseListDto,
} from './dto/purchasing-responses.dto';
import { SuppliersService } from './suppliers.service';

/** Largest amount one bill may come to: Rs 2 crore, in paise (the database enforces the same cap). */
const MAX_BILL_PAISE = 2_000_000_000;

type PurchaseWithLines = Prisma.PurchaseGetPayload<{
  include: { lines: true; supplier: true; branch: true };
}>;

/**
 * Purchases: recording a supplier's bill when the goods arrive (US-PUR-01, journey J2).
 *
 * What one purchase does, all in ONE transaction (so it happens completely or not at all):
 *  1. checks the supplier, branch and products, the dates, and that this supplier's invoice number is new;
 *  2. spreads the extra costs (freight) over the lines in proportion to their value, to the paisa;
 *  3. for every line, adds the units to stock at their LANDED value (qty x price + share of extra costs), which updates the
 *     weighted average cost, and creates or tops up the batch (for expiry);
 *  4. saves the bill with its lines, and an audit entry.
 *
 * A saved purchase is never edited. A mistake is corrected with a supplier return (goods back to the supplier) or a stock
 * adjustment. Earlier costs are untouched by a later purchase: each purchase only ADDS value, so two purchases at different
 * prices keep both layers and the average is their weighted mean.
 *
 * Idempotent: the Idempotency-Key header makes a retry return the same saved purchase instead of entering it twice.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly engine: StockEngine,
    private readonly idempotency: IdempotencyService,
    private readonly suppliers: SuppliersService,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws DomainError VALIDATION_FAILED (bad dates, expiry in the past, unknown products), CONFLICT (this supplier
   *   invoice number is already entered), BUSINESS_RULE_VIOLATION (switched-off supplier or branch, bill over Rs 2 crore),
   *   NOT_FOUND, FORBIDDEN (branch outside the person's scope), IDEMPOTENCY_KEY_REUSED.
   */
  async create(
    actor: LoadedAccess,
    dto: CreatePurchaseDto,
    idempotencyKey: string | undefined,
    info: RequestInfo,
  ): Promise<{ status: number; body: PurchaseDto; replayed: boolean }> {
    try {
      return await this.tenantTx.run((tx) =>
        this.idempotency.run(
          tx,
          actor.tenantId,
          'purchase.create',
          idempotencyKey,
          dto,
          async () => ({
            status: 201,
            body: await this.record(tx, actor, dto, info),
          }),
        ),
      );
    } catch (error) {
      // Two bills with the same supplier invoice number entered at the same moment: the unique index stops the second.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw invoiceTaken();
      }
      throw error;
    }
  }

  async list(actor: LoadedAccess, query: ListPurchasesQueryDto): Promise<PurchaseListDto> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const scope = new BranchScope(actor);
    return this.tenantTx.run(async (tx) => {
      // A branch that is not this business's looks like it does not exist (404); one the person may not use is 403.
      // A quiet empty list would hide a wrong id and differ from every other branch-bound route.
      if (query.branchId) {
        const branch = await tx.branch.findUnique({ where: { id: query.branchId } });
        if (!branch) throw new DomainError('NOT_FOUND', 'This branch does not exist.');
        scope.assert(branch.id);
      }
      const where: Prisma.PurchaseWhereInput = {
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        branchId: query.branchId ?? scope.filter(),
      };
      const [rows, total] = await Promise.all([
        tx.purchase.findMany({
          where,
          include: { supplier: true, branch: true, _count: { select: { lines: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
        }),
        tx.purchase.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          invoiceRef: row.invoiceRef,
          invoiceDate: dateOnly(row.invoiceDate) as string,
          supplierName: row.supplier.name,
          branchName: row.branch.name,
          lineCount: row._count.lines,
          totalPaise: row.totalPaise,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        limit,
        offset,
      };
    });
  }

  async get(actor: LoadedAccess, purchaseId: string): Promise<PurchaseDto> {
    return this.tenantTx.run(async (tx) => {
      const row = await tx.purchase.findUnique({
        where: { id: purchaseId },
        include: { lines: true, supplier: true, branch: true },
      });
      if (!row) throw new DomainError('NOT_FOUND', 'This purchase does not exist.');
      new BranchScope(actor).assert(row.branchId);
      return this.describe(tx, row);
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async record(
    tx: TenantTransaction,
    actor: LoadedAccess,
    dto: CreatePurchaseDto,
    info: RequestInfo,
  ): Promise<PurchaseDto> {
    const branch = await usableBranch(tx, actor, dto.branchId);
    const supplier = await this.suppliers.load(tx, dto.supplierId);
    if (!supplier.isActive) {
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        `${supplier.name} is switched off. Switch the supplier on first.`,
      );
    }
    await usableProducts(
      tx,
      dto.lines.map((line) => line.productId),
      (i) => `lines[${i}].productId`,
    );

    // --- dates ---
    const today = todayInIndia(this.clock);
    const errors: FieldError[] = [];
    const invoiceDate = parseDateOnly(dto.invoiceDate);
    if (!invoiceDate) errors.push({ field: 'invoiceDate', message: 'Enter a real date.' });
    else if (dto.invoiceDate > today)
      errors.push({ field: 'invoiceDate', message: 'The invoice date cannot be in the future.' });
    const expiries = dto.lines.map((line, index) => {
      if (!line.expiryDate) return null;
      const date = parseDateOnly(line.expiryDate);
      if (!date)
        errors.push({ field: `lines[${index}].expiryDate`, message: 'Enter a real date.' });
      else if (line.expiryDate < today)
        errors.push({
          field: `lines[${index}].expiryDate`,
          message: 'This batch has already expired.',
        });
      return date;
    });
    if (errors.length > 0)
      throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', errors);

    // --- amounts ---
    const extra = dto.otherCostPaise ?? 0;
    const shares = allocateExtraCost(dto.lines, extra);
    const subtotal = dto.lines.reduce((sum, line) => sum + line.qty * line.unitCostPaise, 0);
    const total = subtotal + extra;
    if (subtotal <= 0 || total > MAX_BILL_PAISE) {
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        subtotal <= 0
          ? 'A bill must be worth more than zero.'
          : 'A single bill cannot come to more than Rs 2,00,00,000. Split it, or check for an extra zero.',
      );
    }
    const lineTotals = dto.lines.map((line, i) => landedLineValue(line, shares[i] as number));
    if (lineTotals.some((value) => value > MAX_BILL_PAISE)) {
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        'A single line cannot come to more than Rs 2,00,00,000.',
      );
    }

    // --- this supplier's invoice number must be new ---
    const clash = await tx.purchase.findFirst({
      where: {
        supplierId: supplier.id,
        invoiceRef: { equals: dto.invoiceRef, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (clash) throw invoiceTaken();

    // --- stock ---
    const purchaseId = (
      await tx.purchase.create({
        data: {
          tenantId: actor.tenantId,
          branchId: branch.id,
          supplierId: supplier.id,
          invoiceRef: dto.invoiceRef,
          invoiceDate: invoiceDate as Date,
          otherCostPaise: extra,
          subtotalPaise: subtotal,
          totalPaise: total,
          note: dto.note ?? null,
          createdBy: actor.userId,
        },
        select: { id: true },
      })
    ).id;

    await this.engine.lockPositions(
      tx,
      actor.tenantId,
      branch.id,
      dto.lines.map((line) => line.productId),
    );
    const context = {
      tenantId: actor.tenantId,
      userId: actor.userId,
      refType: 'PURCHASE',
      refId: purchaseId,
    };
    for (const [index, line] of dto.lines.entries()) {
      const { batchId } = await this.engine.receive(tx, context, {
        branchId: branch.id,
        productId: line.productId,
        qty: line.qty,
        valuePaise: lineTotals[index] as number,
        type: 'PURCHASE',
        batch: { batchNo: line.batchNo ?? null, expiryDate: expiries[index] ?? null },
      });
      await tx.purchaseLine.create({
        data: {
          tenantId: actor.tenantId,
          purchaseId,
          productId: line.productId,
          qty: line.qty,
          unitCostPaise: line.unitCostPaise,
          allocatedCostPaise: shares[index] as number,
          lineTotalPaise: lineTotals[index] as number,
          batchId,
          batchNo: line.batchNo ?? null,
          expiryDate: expiries[index] ?? null,
        },
      });
    }

    // Amounts are deliberately NOT written to the audit log: it can be read by people who may not see costs.
    await this.audit.write(
      tx,
      {
        action: 'purchase.created',
        actorUserId: actor.userId,
        actorRole: actor.roleName,
        entity: 'purchase',
        entityId: purchaseId,
        metadata: { invoiceRef: dto.invoiceRef, lineCount: dto.lines.length },
      },
      info,
    );

    const saved = await tx.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: { lines: true, supplier: true, branch: true },
    });
    return this.describe(tx, saved);
  }

  private async describe(tx: TenantTransaction, row: PurchaseWithLines): Promise<PurchaseDto> {
    const [products, creator] = await Promise.all([
      tx.product.findMany({ where: { id: { in: row.lines.map((line) => line.productId) } } }),
      row.createdBy
        ? tx.user.findUnique({ where: { id: row.createdBy }, select: { fullName: true } })
        : null,
    ]);
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      id: row.id,
      branchId: row.branchId,
      branchName: row.branch.name,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      invoiceRef: row.invoiceRef,
      invoiceDate: dateOnly(row.invoiceDate) as string,
      otherCostPaise: row.otherCostPaise,
      subtotalPaise: row.subtotalPaise,
      totalPaise: row.totalPaise,
      note: row.note,
      createdByName: creator?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
      lines: [...row.lines]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((line): PurchaseLineDetailDto => ({
          productId: line.productId,
          productName: byId.get(line.productId)?.name ?? '',
          brand: byId.get(line.productId)?.brand ?? '',
          variant: byId.get(line.productId)?.variant ?? '',
          qty: line.qty,
          unitCostPaise: line.unitCostPaise,
          allocatedCostPaise: line.allocatedCostPaise,
          lineTotalPaise: line.lineTotalPaise,
          landedUnitCostPaise: unitCostOf(line.lineTotalPaise, line.qty),
          batchNo: line.batchNo,
          expiryDate: dateOnly(line.expiryDate),
        })),
    };
  }
}

function invoiceTaken(): DomainError {
  return new DomainError('CONFLICT', "This supplier's invoice number is already entered.", [
    {
      field: 'invoiceRef',
      message:
        "This supplier's invoice number is already entered. Open the purchase list to see it.",
    },
  ]);
}
