import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
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
  /** Most batches `sealAll` seals in one call (500 x 200 = 100,000 rows). */
  private static readonly MAX_BATCHES = 200;
  /** Links checked per database round trip when verifying. */
  private static readonly VERIFY_PAGE = 1000;

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

      const pendingIds = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT a.id FROM audit_log a
        WHERE NOT EXISTS (SELECT 1 FROM audit_chain c WHERE c.audit_id = a.id)
        ORDER BY a.created_at, a.id
        LIMIT ${AuditChainService.BATCH}`;
      // One read for the whole batch (not one per row), kept in the order the ids came back.
      const rows = await tx.auditLog.findMany({
        where: { id: { in: pendingIds.map(({ id }) => id) } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const seals: Prisma.AuditChainCreateManyInput[] = [];
      for (const { id } of pendingIds) {
        const hash = sealHash(previous, byId.get(id) as AuditLog);
        seq += 1;
        seals.push({ tenantId, seq, auditId: id, prevHash: previous, hash });
        previous = hash;
      }
      await tx.auditChain.createMany({ data: seals });
      return seals.length;
    });
  }

  /**
   * Seal everything that is waiting, batch after batch (a business that has been busy for a while can have thousands of
   * unsealed rows). Stops after a generous number of batches so one request cannot run for ever; `verify` reports any rest.
   */
  async sealAll(): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < AuditChainService.MAX_BATCHES; batch += 1) {
      const sealed = await this.seal();
      total += sealed;
      if (sealed < AuditChainService.BATCH) break;
    }
    return total;
  }

  /**
   * Walk the whole chain and say whether every seal still matches its audit row. Reads only.
   *
   * It reads one page of the chain at a time and fetches that page's audit rows in ONE query. Each page runs in its own
   * short transaction (a long log would otherwise outlive the 15-second limit of a single one). That is safe because
   * both tables are append-only: rows added between pages only extend the chain, and a row removed or changed in
   * between is exactly what this check exists to find. `sealed` is the number of links actually walked.
   */
  async verify(): Promise<ChainReport> {
    let previous = '';
    let walked = 0;
    let broken: { seq: number; problem: string } | null = null;

    while (!broken) {
      const page = await this.tenantTx.run(async (tx) => {
        const links = await tx.auditChain.findMany({
          where: { seq: { gt: walked } },
          orderBy: { seq: 'asc' },
          take: AuditChainService.VERIFY_PAGE,
        });
        const rows = await tx.auditLog.findMany({
          where: { id: { in: links.map((link) => link.auditId) } },
        });
        return { links, byId: new Map(rows.map((row) => [row.id, row])) };
      });
      if (page.links.length === 0) break;
      for (const link of page.links) {
        const problem = this.problemWith(link, walked + 1, previous, page.byId.get(link.auditId));
        if (problem) {
          broken = { seq: link.seq, problem };
          break;
        }
        walked += 1;
        previous = link.hash;
      }
    }

    const unsealed = await this.tenantTx.run(async (tx) =>
      Number(
        (
          await tx.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM audit_log a
            WHERE NOT EXISTS (SELECT 1 FROM audit_chain c WHERE c.audit_id = a.id)`
        )[0]?.n ?? 0n,
      ),
    );
    return {
      ok: broken === null,
      sealed: walked,
      unsealed,
      firstBrokenSeq: broken?.seq ?? null,
      problem: broken?.problem ?? null,
    };
  }

  /** What is wrong with one link of the chain, or null when it is sound. */
  private problemWith(
    link: { seq: number; prevHash: string; hash: string },
    expectedSeq: number,
    previous: string,
    row: AuditLog | undefined,
  ): string | null {
    if (link.seq !== expectedSeq) return 'A seal is missing from the chain.';
    if (link.prevHash !== previous) return 'A seal does not follow from the one before it.';
    if (!row) return 'A sealed audit entry has been removed.';
    if (sealHash(previous, row) !== link.hash) return 'A sealed audit entry has been changed.';
    return null;
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
