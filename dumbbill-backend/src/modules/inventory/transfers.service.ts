import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LoadedAccess } from '../permissions/access.service';
import { BranchScope } from '../permissions/branch-scope';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { CreateTransferDto, ListTransfersQueryDto } from './dto/inventory-requests.dto';
import { TransferDto, TransferListDto } from './dto/inventory-responses.dto';
import { StockEngine, toNumber } from './stock-engine';
import { dateOnly, usableBranch, usableProducts } from './support';

type TransferWithLines = Prisma.StockTransferGetPayload<{ include: { lines: true } }>;

/**
 * Transfers: moving goods between two branches in two steps (US-STK-01, journey J5).
 *
 *  1. SEND (needs the sending branch): the goods leave NOW (ledger TRANSFER_OUT at the sending branch's weighted average
 *     cost) and the transfer is "in transit". The cost is written on the transfer lines so it travels with the goods.
 *  2. RECEIVE (needs the receiving branch): the goods arrive (ledger TRANSFER_IN) at exactly the value they left with, in
 *     the same batches (same batch number and expiry date). Or CANCEL (needs the sending branch): the goods go back
 *     (ledger TRANSFER_CANCEL) at the value they left with.
 *
 * While goods are in transit they are in NEITHER branch's stock: nothing is double counted and nothing disappears. A transfer
 * can be received or cancelled only once; two people acting at the same moment are serialised by a row lock, so the
 * second one is told it is already done.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly engine: StockEngine,
    private readonly idempotency: IdempotencyService,
    private readonly clock: Clock,
  ) {}

  async create(
    actor: LoadedAccess,
    dto: CreateTransferDto,
    idempotencyKey: string | undefined,
    info: RequestInfo,
  ): Promise<{ status: number; body: TransferDto; replayed: boolean }> {
    return this.tenantTx.run((tx) =>
      this.idempotency.run(
        tx,
        actor.tenantId,
        'stock.transfer.create',
        idempotencyKey,
        dto,
        async () => {
          if (dto.fromBranchId === dto.toBranchId) {
            throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', [
              {
                field: 'toBranchId',
                message: 'Choose a different branch from the one the goods leave.',
              },
            ]);
          }
          const from = await usableBranch(tx, actor, dto.fromBranchId, 'fromBranchId');
          // The receiving branch need not be one the sender works in, but it must exist and be switched on.
          const to = await tx.branch.findUnique({ where: { id: dto.toBranchId } });
          if (!to) {
            throw new DomainError('NOT_FOUND', 'The receiving branch does not exist.', [
              { field: 'toBranchId', message: 'This branch does not exist.' },
            ]);
          }
          if (!to.isActive)
            throw new DomainError('BUSINESS_RULE_VIOLATION', `${to.name} is switched off.`);
          await usableProducts(
            tx,
            dto.lines.map((line) => line.productId),
            (i) => `lines[${i}].productId`,
          );

          const transfer = await tx.stockTransfer.create({
            data: {
              tenantId: actor.tenantId,
              fromBranchId: from.id,
              toBranchId: to.id,
              note: dto.note ?? null,
              createdBy: actor.userId,
            },
          });
          await this.engine.lockPositions(
            tx,
            actor.tenantId,
            from.id,
            dto.lines.map((line) => line.productId),
          );
          const context = {
            tenantId: actor.tenantId,
            userId: actor.userId,
            refType: 'TRANSFER',
            refId: transfer.id,
          };
          for (const line of dto.lines) {
            const slices = await this.engine.remove(tx, context, {
              branchId: from.id,
              productId: line.productId,
              qty: line.qty,
              type: 'TRANSFER_OUT',
            });
            await tx.stockTransferLine.createMany({
              data: slices.map((slice) => ({
                tenantId: actor.tenantId,
                transferId: transfer.id,
                productId: line.productId,
                qty: slice.qty,
                valuePaise: BigInt(slice.valuePaise),
                batchNo: slice.batchNo,
                expiryDate: slice.expiryDate,
              })),
            });
          }
          await this.audit.write(
            tx,
            {
              action: 'stock.transfer_sent',
              actorUserId: actor.userId,
              actorRole: actor.roleName,
              entity: 'stock_transfer',
              entityId: transfer.id,
              metadata: { fromBranchId: from.id, toBranchId: to.id, lineCount: dto.lines.length },
            },
            info,
          );
          return { status: 201, body: await this.describe(tx, transfer.id) };
        },
      ),
    );
  }

  /**
   * The receiving branch confirms the goods arrived.
   * @throws DomainError CONFLICT when the transfer was already received or cancelled; FORBIDDEN for a branch the person may not use.
   */
  async receive(actor: LoadedAccess, transferId: string, info: RequestInfo): Promise<TransferDto> {
    return this.tenantTx.run(async (tx) => {
      const transfer = await this.lockInTransit(tx, transferId);
      const to = await usableBranch(tx, actor, transfer.toBranchId, 'toBranchId');
      const productIds = transfer.lines.map((line) => line.productId);
      await this.engine.lockPositions(tx, actor.tenantId, to.id, productIds);
      const context = {
        tenantId: actor.tenantId,
        userId: actor.userId,
        refType: 'TRANSFER',
        refId: transfer.id,
      };
      for (const line of transfer.lines) {
        await this.engine.receive(tx, context, {
          branchId: to.id,
          productId: line.productId,
          qty: line.qty,
          valuePaise: toNumber(line.valuePaise),
          type: 'TRANSFER_IN',
          batch: { batchNo: line.batchNo, expiryDate: line.expiryDate },
        });
      }
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'RECEIVED', receivedBy: actor.userId, receivedAt: this.clock.now() },
      });
      await this.audit.write(
        tx,
        {
          action: 'stock.transfer_received',
          actorUserId: actor.userId,
          actorRole: actor.roleName,
          entity: 'stock_transfer',
          entityId: transfer.id,
          metadata: { fromBranchId: transfer.fromBranchId, toBranchId: to.id },
        },
        info,
      );
      return this.describe(tx, transfer.id);
    });
  }

  /**
   * The sending branch takes the goods back before they arrive.
   * @throws DomainError CONFLICT when the transfer was already received or cancelled.
   */
  async cancel(actor: LoadedAccess, transferId: string, info: RequestInfo): Promise<TransferDto> {
    return this.tenantTx.run(async (tx) => {
      const transfer = await this.lockInTransit(tx, transferId);
      const from = await usableBranch(tx, actor, transfer.fromBranchId, 'fromBranchId');
      await this.engine.lockPositions(
        tx,
        actor.tenantId,
        from.id,
        transfer.lines.map((line) => line.productId),
      );
      const context = {
        tenantId: actor.tenantId,
        userId: actor.userId,
        refType: 'TRANSFER',
        refId: transfer.id,
      };
      for (const line of transfer.lines) {
        await this.engine.receive(tx, context, {
          branchId: from.id,
          productId: line.productId,
          qty: line.qty,
          valuePaise: toNumber(line.valuePaise),
          type: 'TRANSFER_CANCEL',
          batch: { batchNo: line.batchNo, expiryDate: line.expiryDate },
        });
      }
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'CANCELLED', cancelledBy: actor.userId, cancelledAt: this.clock.now() },
      });
      await this.audit.write(
        tx,
        {
          action: 'stock.transfer_cancelled',
          actorUserId: actor.userId,
          actorRole: actor.roleName,
          entity: 'stock_transfer',
          entityId: transfer.id,
          metadata: { fromBranchId: from.id, toBranchId: transfer.toBranchId },
        },
        info,
      );
      return this.describe(tx, transfer.id);
    });
  }

  async list(actor: LoadedAccess, query: ListTransfersQueryDto): Promise<TransferListDto> {
    const scope = new BranchScope(actor);
    return this.tenantTx.run(async (tx) => {
      const ids = scope.filter();
      const rows = await tx.stockTransfer.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(ids ? { OR: [{ fromBranchId: ids }, { toBranchId: ids }] } : {}),
        },
        include: { lines: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      });
      return { items: await this.describeMany(tx, rows) };
    });
  }

  async get(actor: LoadedAccess, transferId: string): Promise<TransferDto> {
    return this.tenantTx.run(async (tx) => {
      const row = await tx.stockTransfer.findUnique({
        where: { id: transferId },
        include: { lines: true },
      });
      if (!row) throw new DomainError('NOT_FOUND', 'This transfer does not exist.');
      const scope = new BranchScope(actor);
      // Either end of the transfer may look at it.
      if (!scope.allows(row.fromBranchId) && !scope.allows(row.toBranchId))
        scope.assert(row.fromBranchId);
      return (await this.describeMany(tx, [row]))[0] as TransferDto;
    });
  }

  // ---------------------------------------------------------------------------------------------

  /** Lock the transfer row and make sure it is still in transit: only one person can receive or cancel it. */
  private async lockInTransit(
    tx: TenantTransaction,
    transferId: string,
  ): Promise<TransferWithLines> {
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM stock_transfers WHERE id = ${transferId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new DomainError('NOT_FOUND', 'This transfer does not exist.');
    const row = await tx.stockTransfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { lines: true },
    });
    if (row.status !== 'IN_TRANSIT') {
      throw new DomainError(
        'CONFLICT',
        row.status === 'RECEIVED'
          ? 'This transfer has already been received.'
          : 'This transfer has been cancelled.',
      );
    }
    return row;
  }

  private async describe(tx: TenantTransaction, transferId: string): Promise<TransferDto> {
    const row = await tx.stockTransfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { lines: true },
    });
    return (await this.describeMany(tx, [row]))[0] as TransferDto;
  }

  private async describeMany(
    tx: TenantTransaction,
    rows: TransferWithLines[],
  ): Promise<TransferDto[]> {
    const [branches, products] = await Promise.all([
      tx.branch.findMany(),
      tx.product.findMany({
        where: { id: { in: rows.flatMap((row) => row.lines.map((line) => line.productId)) } },
      }),
    ]);
    const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
    const productName = new Map(products.map((product) => [product.id, product.name]));
    return rows.map((row) => ({
      id: row.id,
      fromBranchId: row.fromBranchId,
      fromBranchName: branchName.get(row.fromBranchId) ?? '',
      toBranchId: row.toBranchId,
      toBranchName: branchName.get(row.toBranchId) ?? '',
      status: row.status,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      receivedAt: row.receivedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      // No value on purpose: the cost that travels with the goods is not shown to people without cost access.
      lines: [...row.lines]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((line) => ({
          productId: line.productId,
          productName: productName.get(line.productId) ?? '',
          qty: line.qty,
          batchNo: line.batchNo,
          expiryDate: dateOnly(line.expiryDate),
        })),
    }));
  }
}
