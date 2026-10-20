import { Injectable } from '@nestjs/common';
import { AuditLog } from '@prisma/client';
import { createHash } from 'node:crypto';
import { stableJson } from '../../common/stable-json';
import { getTenantContext } from '../tenancy/tenant-context';
import { TenantTx } from '../tenancy/tenant-tx.service';

/** What `verify` reports. */
export interface ChainReport {
  /** True when every sealed audit row still matches its seal, and no seal is missing or out of order. */
  ok: boolean;
  /** How many audit rows have been sealed. */
  sealed: number;
  /** Audit rows written but not yet sealed (normal for the last few moments; `seal` catches them up). */
  unsealed: number;
  /** The first seal that does not match, when `ok` is false. */
  firstBrokenSeq: number | null;
  problem: string | null;
}

/**
 * The tamper-evident chain over the audit log (security.md section 6).
 *
 * THE IDEA: the audit log already cannot be changed by the app (no UPDATE or DELETE right, and a trigger for everyone
 * else). The chain adds PROOF: every audit row is "sealed" once, in order, and each seal is a SHA-256 hash of the row's
 * content plus the previous seal. Changing or deleting any sealed row (by someone with direct database access who disables
 * the protections) makes its hash wrong, and every hash after it too, so `verify` points at the first row that was touched.
 *
 * WHY SEALING IS SEPARATE FROM WRITING: audit rows are written inside business transactions that run at the same moment.
 * Chaining at write time would force every such transaction to queue behind the others. Instead rows are written freely and
 * sealed later, by `seal`, one sealer at a time per business (a database lock). The chain's order is the order rows were
 * sealed, which is deterministic and checkable even if two transactions committed in a different order than they started.
 *
 * LIMITS: someone who can rewrite BOTH tables and recompute every later hash can forge a chain. Defending against that
 * needs the latest hash stored somewhere the database owner cannot write (the plan: anchor it periodically to S3 Object
 * Lock when deployment exists). `seal` runs whenever the audit log is viewed; a scheduled job will call it too.
 */
@Injectable()
export class AuditChainService {
  /** Most rows sealed per call; a viewer or job calls again for more. */
  private static readonly BATCH = 500;

  constructor(private readonly tenantTx: TenantTx) {}

  /** Seal the audit rows that are not sealed yet, oldest first. Returns how many were sealed. */
  async seal(): Promise<number> {
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId) throw new Error('AuditChainService.seal() needs a tenant context.');
    return this.tenantTx.run(async (tx) => {
      // One sealer at a time for this business: the lock is released when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit-chain:${tenantId}`}))`;
      const last = await tx.auditChain.findFirst({ orderBy: { seq: 'desc' } });
      let seq = last?.seq ?? 0;
      let previous = last?.hash ?? '';

      const pending = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT a.id FROM audit_log a
        WHERE NOT EXISTS (SELECT 1 FROM audit_chain c WHERE c.audit_id = a.id)
        ORDER BY a.created_at, a.id
        LIMIT ${AuditChainService.BATCH}`;
      for (const { id } of pending) {
        const row = await tx.auditLog.findUniqueOrThrow({ where: { id } });
        const hash = sealHash(previous, row);
        seq += 1;
        await tx.auditChain.create({
          data: { tenantId, seq, auditId: id, prevHash: previous, hash },
        });
        previous = hash;
      }
      return pending.length;
    });
  }

  /** Walk the whole chain and say whether every seal still matches its audit row. Reads only. */
  async verify(): Promise<ChainReport> {
    return this.tenantTx.run(async (tx) => {
      const chain = await tx.auditChain.findMany({ orderBy: { seq: 'asc' } });
      const unsealed = Number(
        (
          await tx.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM audit_log a
            WHERE NOT EXISTS (SELECT 1 FROM audit_chain c WHERE c.audit_id = a.id)`
        )[0]?.n ?? 0n,
      );
      let previous = '';
      let expectedSeq = 0;
      for (const link of chain) {
        expectedSeq += 1;
        const broken = (problem: string): ChainReport => ({
          ok: false,
          sealed: chain.length,
          unsealed,
          firstBrokenSeq: link.seq,
          problem,
        });
        if (link.seq !== expectedSeq) return broken('A seal is missing from the chain.');
        if (link.prevHash !== previous)
          return broken('A seal does not follow from the one before it.');
        const row = await tx.auditLog.findUnique({ where: { id: link.auditId } });
        if (!row) return broken('A sealed audit entry has been removed.');
        if (sealHash(previous, row) !== link.hash)
          return broken('A sealed audit entry has been changed.');
        previous = link.hash;
      }
      return { ok: true, sealed: chain.length, unsealed, firstBrokenSeq: null, problem: null };
    });
  }
}

/**
 * The hash of one audit row given the previous seal. It covers every field that says what happened, so a change to any of
 * them is detected. (JSON columns are written with keys in a fixed order so the same data always hashes the same.)
 */
export function sealHash(previousHash: string, row: AuditLog): string {
  const content = stableJson([
    row.id,
    row.tenantId,
    row.actorUserId,
    row.action,
    row.entity,
    row.entityId,
    row.metadata,
    row.ipAddress,
    row.userAgent,
    row.requestId,
    row.actorRole,
    row.before,
    row.after,
    row.createdAt.toISOString(),
  ]);
  return createHash('sha256').update(`${previousHash}\n${content}`).digest('hex');
}
