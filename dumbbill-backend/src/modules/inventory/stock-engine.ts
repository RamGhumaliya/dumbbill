import { Injectable } from '@nestjs/common';
import { LedgerType } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { TenantTransaction } from '../tenancy/tenant-tx.service';
import {
  applyInflow,
  applyOutflow,
  InsufficientStockError,
  Movement,
  StockPosition,
} from './domain/costing';

/** Who is moving the stock and why. Written onto every ledger row the movement creates. */
export interface MoveContext {
  tenantId: string;
  userId: string;
  /** What caused it: PURCHASE, ADJUSTMENT, TRANSFER, SUPPLIER_RETURN, WRITE_OFF (and INVOICE from Phase 2). */
  refType: string;
  refId?: string;
  reason?: string;
  note?: string;
}

/** A piece of stock that was taken out, with the value that went with it. Used to carry cost along (transfers, returns). */
export interface RemovedSlice {
  batchId: string | null;
  batchNo: string | null;
  expiryDate: Date | null;
  qty: number;
  /** What these units were worth when they left, in paise. CONFIDENTIAL. */
  valuePaise: number;
}

/** Convert a database BigInt to an ordinary number, refusing anything too big to hold exactly. */
export function toNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Amount too large to hold exactly: ${value}`);
  return n;
}

/**
 * The ONE place stock changes (US-STK-01). Every purchase, count, transfer, return and (from Phase 2) sale goes through
 * here, so the rules cannot differ between features:
 *
 *  - Each change is written as a row of the append-only ledger AND applied to the stock level, in the caller's transaction.
 *    The level is a projection of the ledger; a check proves they agree.
 *  - The numbers come from the pure costing functions (domain/costing.ts); this class only reads, locks and writes.
 *  - Positions are LOCKED (`SELECT ... FOR UPDATE`) before they are read, always in the same order (by product id), so
 *    two sales of the last unit cannot both succeed and two multi-product changes cannot deadlock.
 *  - Stock never goes below zero: asking for more than is on hand is INSUFFICIENT_STOCK. (A shop policy that allows
 *    negative stock arrives with the till in Phase 2.)
 *  - Units also live in batches (for expiry). Stock leaves the batch that expires first (FEFO: first expiry, first out),
 *    batches without an expiry date last, unless a specific batch is asked for.
 *
 * Every method needs an open tenant transaction; none opens its own.
 */
@Injectable()
export class StockEngine {
  /**
   * Lock the stock positions a change is about to touch, creating empty ones for products never stocked at this branch.
   * Call once per transaction, with every product the change involves, BEFORE any `receive` or `remove`.
   */
  async lockPositions(
    tx: TenantTransaction,
    tenantId: string,
    branchId: string,
    productIds: string[],
  ): Promise<void> {
    // Sorted, de-duplicated: everyone locks in the same order, which is what prevents deadlocks.
    const ids = [...new Set(productIds)].sort();
    if (ids.length === 0) return;
    await tx.stockLevel.createMany({
      data: ids.map((productId) => ({ tenantId, branchId, productId, qty: 0, valuePaise: 0n })),
      skipDuplicates: true,
    });
    await tx.$queryRaw`SELECT 1 FROM stock_levels WHERE branch_id = ${branchId}::uuid AND product_id = ANY(${ids}::uuid[]) ORDER BY product_id FOR UPDATE`;
  }

  /** What a branch holds of a product right now. The position must have been locked by this transaction. */
  async position(
    tx: TenantTransaction,
    branchId: string,
    productId: string,
  ): Promise<StockPosition> {
    const level = await tx.stockLevel.findUnique({
      where: { branchId_productId: { branchId, productId } },
    });
    return level
      ? { qty: level.qty, valuePaise: toNumber(level.valuePaise) }
      : { qty: 0, valuePaise: 0 };
  }

  /**
   * Add units worth `valuePaise` in total (a purchase, an arriving transfer, a cancelled transfer, a recount that found
   * extra). The units go into the batch named by `batch.batchId`, or into the batch with this batch number and expiry date
   * (made if it does not exist yet; no number and no date means the shared "no batch" lot).
   */
  async receive(
    tx: TenantTransaction,
    ctx: MoveContext,
    args: {
      branchId: string;
      productId: string;
      qty: number;
      valuePaise: number;
      type: LedgerType;
      batch?: { batchId?: string; batchNo?: string | null; expiryDate?: Date | null };
    },
  ): Promise<{ batchId: string; movement: Movement }> {
    const before = await this.position(tx, args.branchId, args.productId);
    const movement = applyInflow(before, args.qty, args.valuePaise);

    const batchId = await this.addToBatch(tx, ctx.tenantId, args);
    await this.writeLedger(tx, ctx, args.branchId, args.productId, batchId, args.type, movement);
    await this.writeLevel(tx, args.branchId, args.productId, movement.position);
    return { batchId, movement };
  }

  /**
   * Remove units at the current weighted average cost, taking them from the batches that expire first (or from one named
   * batch). Returns what left, slice by slice, with the value of each slice, so the caller can carry the cost along
   * (a transfer) or record it (a return, a write-off).
   *
   * @throws DomainError INSUFFICIENT_STOCK when fewer units are on hand (or in the named batch) than requested.
   */
  async remove(
    tx: TenantTransaction,
    ctx: MoveContext,
    args: { branchId: string; productId: string; qty: number; type: LedgerType; batchId?: string },
  ): Promise<RemovedSlice[]> {
    let position = await this.position(tx, args.branchId, args.productId);
    if (args.qty > position.qty) throw insufficient(position.qty, args.qty);

    const batches = args.batchId
      ? await tx.stockBatch.findMany({
          where: {
            id: args.batchId,
            branchId: args.branchId,
            productId: args.productId,
            qtyRemaining: { gt: 0 },
          },
        })
      : await tx.stockBatch.findMany({
          where: { branchId: args.branchId, productId: args.productId, qtyRemaining: { gt: 0 } },
          orderBy: [
            { expiryDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        });

    const slices: RemovedSlice[] = [];
    let remaining = args.qty;
    for (const batch of batches) {
      if (remaining === 0) break;
      const take = Math.min(batch.qtyRemaining, remaining);
      const movement = applyOutflow(position, take);
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { qtyRemaining: batch.qtyRemaining - take },
      });
      await this.writeLedger(tx, ctx, args.branchId, args.productId, batch.id, args.type, movement);
      slices.push({
        batchId: batch.id,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        qty: take,
        valuePaise: -movement.valueDeltaPaise,
      });
      position = movement.position;
      remaining -= take;
    }
    if (remaining > 0) {
      // A named batch with too little in it. (With no batch named, the batches always add up to the level; if they ever
      // do not, the check endpoint reports it, and this refuses to guess.)
      if (args.batchId) throw insufficient(args.qty - remaining, args.qty);
      throw new Error(`Batches of product ${args.productId} do not add up to its stock level.`);
    }
    await this.writeLevel(tx, args.branchId, args.productId, position);
    return slices;
  }

  /** Put units into a batch, creating it when this (batch number, expiry date) has not been seen at this branch. */
  private async addToBatch(
    tx: TenantTransaction,
    tenantId: string,
    args: {
      branchId: string;
      productId: string;
      qty: number;
      batch?: { batchId?: string; batchNo?: string | null; expiryDate?: Date | null };
    },
  ): Promise<string> {
    const wanted = args.batch ?? {};
    if (wanted.batchId) {
      const batch = await tx.stockBatch.findFirst({
        where: { id: wanted.batchId, branchId: args.branchId, productId: args.productId },
      });
      if (!batch) throw new DomainError('NOT_FOUND', 'This batch does not exist.');
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { qtyRemaining: batch.qtyRemaining + args.qty },
      });
      return batch.id;
    }
    const batchNo = wanted.batchNo ?? null;
    const expiryDate = wanted.expiryDate ?? null;
    const existing = await tx.stockBatch.findFirst({
      where: { branchId: args.branchId, productId: args.productId, batchNo, expiryDate },
    });
    if (existing) {
      await tx.stockBatch.update({
        where: { id: existing.id },
        data: { qtyRemaining: existing.qtyRemaining + args.qty },
      });
      return existing.id;
    }
    const made = await tx.stockBatch.create({
      data: {
        tenantId,
        branchId: args.branchId,
        productId: args.productId,
        batchNo,
        expiryDate,
        qtyRemaining: args.qty,
      },
    });
    return made.id;
  }

  private async writeLedger(
    tx: TenantTransaction,
    ctx: MoveContext,
    branchId: string,
    productId: string,
    batchId: string,
    type: LedgerType,
    movement: Movement,
  ): Promise<void> {
    await tx.stockLedger.create({
      data: {
        tenantId: ctx.tenantId,
        branchId,
        productId,
        batchId,
        type,
        qtyDelta: movement.qtyDelta,
        valueDeltaPaise: BigInt(movement.valueDeltaPaise),
        unitCostPaise: movement.unitCostPaise,
        qtyAfter: movement.position.qty,
        valueAfterPaise: BigInt(movement.position.valuePaise),
        wacAfterPaise: movement.wacAfterPaise,
        refType: ctx.refType,
        refId: ctx.refId ?? null,
        reason: ctx.reason ?? null,
        note: ctx.note ?? null,
        createdBy: ctx.userId,
      },
    });
  }

  private async writeLevel(
    tx: TenantTransaction,
    branchId: string,
    productId: string,
    position: StockPosition,
  ): Promise<void> {
    await tx.stockLevel.update({
      where: { branchId_productId: { branchId, productId } },
      data: {
        qty: position.qty,
        valuePaise: BigInt(position.valuePaise),
        version: { increment: 1 },
      },
    });
  }
}

/** The error a person sees when a change needs more units than there are. */
function insufficient(available: number, requested: number): DomainError {
  const error = new InsufficientStockError(available, requested);
  return new DomainError(
    'INSUFFICIENT_STOCK',
    `Only ${error.available} in stock, but ${error.requested} are needed.`,
  );
}
