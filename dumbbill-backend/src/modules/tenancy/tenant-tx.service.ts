import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertUuid,
  getTenantContext,
  runWithTenantContext,
  TenantContext,
} from './tenant-context';

/** The query client handed to your code inside a tenant transaction. Use it for every query. */
export type TenantTransaction = Prisma.TransactionClient;

/** Safety limits for one transaction (milliseconds). Stops a stuck request from holding a connection forever. */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * THE way business code talks to the database.
 *
 * It opens a database transaction and, as the very first step, tells PostgreSQL which business (and
 * user) the transaction is for. From then on PostgreSQL's row-level security automatically hides
 * every other business's rows and refuses writes into them, no matter what the query says.
 *
 * Why "transaction-local" settings (`set_config(..., true)`):
 * the database keeps a pool of reusable connections. A normal setting would stay on the connection
 * after the request ends and could leak into the next request, possibly for another business.
 * A transaction-local setting is wiped automatically at COMMIT or ROLLBACK, so that cannot happen.
 *
 * Typical use inside a service:
 *
 *   return this.tenantTx.run((tx) => tx.user.findMany());   // sees only the caller's business
 */
@Injectable()
export class TenantTx {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `work` inside a transaction for the business in the current request context.
   * Throws if there is no context: running without a tenant is a bug, never a silent "see nothing".
   */
  run<T>(work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const context = getTenantContext();
    if (!context) {
      throw new Error(
        'TenantTx.run() called outside a tenant context. Authenticate the request first, or use runAs() in background jobs.',
      );
    }
    return this.runAs(context, work);
  }

  /**
   * Run `work` for an explicit business. Used by background jobs, webhooks and tests, where there is
   * no logged-in request. The caller is responsible for knowing the tenant id is legitimate.
   */
  runAs<T>(context: TenantContext, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    // The ids are placed into database settings, so they must be exact UUIDs.
    assertUuid(context.tenantId, 'tenantId');
    if (context.userId !== undefined) assertUuid(context.userId, 'userId');

    // Also make the business visible to ordinary code running inside `work` (the audit writer, the logger).
    // Without this, work started with runAs() (signup, login, jobs) would be locked to the right business in
    // the database but would not know it in application code, and logs would carry no tenantId.
    return runWithTenantContext(context, () =>
      this.prisma.$transaction(async (tx) => {
        // Parameters ($1, $2) are sent separately from the SQL text, so they cannot inject SQL.
        // The third argument `true` makes the setting local to this transaction.
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true),
                                  set_config('app.user_id', ${context.userId ?? ''}, true)`;
        return work(tx);
      }, TRANSACTION_OPTIONS),
    );
  }
}
