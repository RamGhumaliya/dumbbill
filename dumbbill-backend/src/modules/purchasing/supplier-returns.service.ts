import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, FieldError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { StockEngine } from '../inventory/stock-engine';
import { nextDocumentNumber, usableBranch, usableProducts } from '../inventory/support';
import { LoadedAccess } from '../permissions/access.service';
import { BranchScope } from '../permissions/branch-scope';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { CreateSupplierReturnDto } from './dto/purchasing-requests.dto';
import { SupplierReturnDto, SupplierReturnListDto } from './dto/purchasing-responses.dto';
import { SuppliersService } from './suppliers.service';

type ReturnWithLines = Prisma.SupplierReturnGetPayload<{
  include: { lines: true; supplier: true };
}>;

/**
 * Supplier returns: sending goods back to a supplier (ledger type SUPPLIER_RETURN) with a numbered debit note.
 *
 * What one return does, in ONE transaction:
 *  - takes the units out of stock at the current weighted average cost (from the named batch, or the batches that expire
 *    first), so the cost of what stays is unchanged and the books never go negative;
 *  - records the CREDIT the supplier gives (`unitCreditPaise` x qty), which lowers what the shop owes them;
 *  - numbers the debit note "DN-0001", "DN-0002" ... per business, without gaps or repeats;
 *  - writes an audit entry (amounts are not put in the audit log, only counts).
 *
 * The credit is what was AGREED with the supplier and may differ from the stock's cost; the stock leaves at cost either
 * way, so a difference never distorts the average of what is left. Idempotent through the Idempotency-Key header.
 */
@Injectable()
export class SupplierReturnsService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly engine: StockEngine,
    private readonly idempotency: IdempotencyService,
    private readonly suppliers: SuppliersService,
  ) {}

  /**
   * @throws DomainError INSUFFICIENT_STOCK when a line asks for more than is on hand (nothing is saved),
   *   VALIDATION_FAILED for unknown products, NOT_FOUND, FORBIDDEN (branch outside scope), IDEMPOTENCY_KEY_REUSED.
   */
  async create(
    actor: LoadedAccess,
    dto: CreateSupplierReturnDto,
    idempotencyKey: string | undefined,
    info: RequestInfo,
  ): Promise<{ status: number; body: SupplierReturnDto; replayed: boolean }> {
    return this.tenantTx.run((tx) =>
      this.idempotency.run(
        tx,
        actor.tenantId,
        'supplier-return.create',
        idempotencyKey,
        dto,
        async () => ({
          status: 201,
          body: await this.record(tx, actor, dto, info),
        }),
      ),
    );
  }

  async list(actor: LoadedAccess, supplierId?: string): Promise<SupplierReturnListDto> {
    const scope = new BranchScope(actor);
    return this.tenantTx.run(async (tx) => {
      const rows = await tx.supplierReturn.findMany({
        where: { ...(supplierId ? { supplierId } : {}), branchId: scope.filter() },
        include: { lines: true, supplier: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      });
      return { items: await this.describeMany(tx, rows) };
    });
  }

  async get(actor: LoadedAccess, returnId: string): Promise<SupplierReturnDto> {
    return this.tenantTx.run(async (tx) => {
      const row = await tx.supplierReturn.findUnique({
        where: { id: returnId },
        include: { lines: true, supplier: true },
      });
      if (!row) throw new DomainError('NOT_FOUND', 'This debit note does not exist.');
      new BranchScope(actor).assert(row.branchId);
      return (await this.describeMany(tx, [row]))[0] as SupplierReturnDto;
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async record(
    tx: TenantTransaction,
    actor: LoadedAccess,
    dto: CreateSupplierReturnDto,
    info: RequestInfo,
  ): Promise<SupplierReturnDto> {
    const branch = await usableBranch(tx, actor, dto.branchId);
    const supplier = await this.suppliers.load(tx, dto.supplierId);
    await usableProducts(
      tx,
      dto.lines.map((line) => line.productId),
      (i) => `lines[${i}].productId`,
    );

    const errors: FieldError[] = [];
    if (dto.purchaseId) {
      const purchase = await tx.purchase.findUnique({ where: { id: dto.purchaseId } });
      if (!purchase || purchase.supplierId !== supplier.id) {
        errors.push({
          field: 'purchaseId',
          message: "This purchase is not one of this supplier's bills.",
        });
      }
    }
    if (errors.length > 0)
      throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', errors);

    const credits = dto.lines.map((line) => line.qty * line.unitCreditPaise);
    const creditTotal = credits.reduce((sum, credit) => sum + credit, 0);
    if (creditTotal > 2_000_000_000) {
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        'A single debit note cannot come to more than Rs 2,00,00,000.',
      );
    }

    const number = await nextDocumentNumber(tx, actor.tenantId, 'DN');
    const created = await tx.supplierReturn.create({
      data: {
        tenantId: actor.tenantId,
        branchId: branch.id,
        supplierId: supplier.id,
        debitNoteNo: `DN-${String(number).padStart(4, '0')}`,
        reason: dto.reason,
        creditTotalPaise: creditTotal,
        note: dto.note ?? null,
        createdBy: actor.userId,
      },
    });

    await this.engine.lockPositions(
      tx,
      actor.tenantId,
      branch.id,
      dto.lines.map((line) => line.productId),
    );
    const context = {
      tenantId: actor.tenantId,
      userId: actor.userId,
      refType: 'SUPPLIER_RETURN',
      refId: created.id,
      reason: dto.reason,
    };
    for (const [index, line] of dto.lines.entries()) {
      const slices = await this.engine.remove(tx, context, {
        branchId: branch.id,
        productId: line.productId,
        qty: line.qty,
        type: 'SUPPLIER_RETURN',
        batchId: line.batchId,
      });
      await tx.supplierReturnLine.create({
        data: {
          tenantId: actor.tenantId,
          returnId: created.id,
          productId: line.productId,
          batchId: line.batchId ?? null,
          qty: line.qty,
          unitCreditPaise: line.unitCreditPaise,
          creditPaise: credits[index] as number,
          costValuePaise: BigInt(slices.reduce((sum, slice) => sum + slice.valuePaise, 0)),
        },
      });
    }

    await this.audit.write(
      tx,
      {
        action: 'supplier_return.created',
        actorUserId: actor.userId,
        actorRole: actor.roleName,
        entity: 'supplier_return',
        entityId: created.id,
        metadata: {
          debitNoteNo: created.debitNoteNo,
          lineCount: dto.lines.length,
          reason: dto.reason,
        },
      },
      info,
    );

    const saved = await tx.supplierReturn.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: true, supplier: true },
    });
    return (await this.describeMany(tx, [saved]))[0] as SupplierReturnDto;
  }

  private async describeMany(
    tx: TenantTransaction,
    rows: ReturnWithLines[],
  ): Promise<SupplierReturnDto[]> {
    const [products, branches] = await Promise.all([
      tx.product.findMany({
        where: { id: { in: rows.flatMap((row) => row.lines.map((line) => line.productId)) } },
      }),
      tx.branch.findMany({ where: { id: { in: rows.map((row) => row.branchId) } } }),
    ]);
    const productName = new Map(products.map((product) => [product.id, product.name]));
    const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
    return rows.map((row) => ({
      id: row.id,
      debitNoteNo: row.debitNoteNo,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      branchId: row.branchId,
      branchName: branchName.get(row.branchId) ?? '',
      reason: row.reason,
      creditTotalPaise: row.creditTotalPaise,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      lines: [...row.lines]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((line) => ({
          productId: line.productId,
          productName: productName.get(line.productId) ?? '',
          qty: line.qty,
          unitCreditPaise: line.unitCreditPaise,
          creditPaise: line.creditPaise,
        })),
    }));
  }
}
