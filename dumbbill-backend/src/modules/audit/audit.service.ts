import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getRequestContext } from '../../common/request-context/request-context';
import { getTenantContext } from '../tenancy/tenant-context';
import { TenantTransaction } from '../tenancy/tenant-tx.service';

/** Details about the HTTP request an event came from. Stored so a suspicious sign-in can be traced. */
export interface RequestInfo {
  /** The visitor's IP address. */
  ip?: string;
  /** The browser or app identification string. */
  userAgent?: string;
}

/** One thing that happened, to be written to the audit log. */
export interface AuditEvent {
  /** Dotted name, for example `auth.login` or `auth.password_changed`. */
  action: string;
  /** The staff member who did it (omit for the system). */
  actorUserId?: string;
  /** What it was done to, for example `session`. */
  entity?: string;
  entityId?: string;
  /** Small extra facts. NEVER put passwords, tokens, secrets or cost figures here. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Writes the audit log (hard rule 7: every sensitive event is audited).
 *
 * The audit log is the BUSINESS record of who did what. Unlike the technical logs, it is stored in the
 * database, cannot be edited or deleted (the table is append-only), and is kept for years.
 *
 * It is written INSIDE the same database transaction as the action itself: either the password change and
 * its audit row both happen, or neither does. So there is never an action without a record.
 */
@Injectable()
export class AuditService {
  /**
   * Add one row. Call it with the transaction that is doing the work, for example:
   *   `await this.tenantTx.run(async (tx) => { ...; await this.audit.write(tx, event, info); })`
   * The business id comes from the tenant context that `TenantTx` already set.
   */
  async write(tx: TenantTransaction, event: AuditEvent, info: RequestInfo = {}): Promise<void> {
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId) throw new Error('AuditService.write() needs a tenant context.');
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        entity: event.entity ?? null,
        entityId: event.entityId ?? null,
        metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: info.ip ?? null,
        // A very long User-Agent is cut: it is only a hint for humans.
        userAgent: info.userAgent?.slice(0, 300) ?? null,
        requestId: getRequestContext()?.requestId ?? null,
      },
    });
  }
}
