import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is making the current request, as far as the database is concerned.
 * The login guard (added in P1-1) fills this in from the verified access token.
 */
export interface TenantContext {
  /** The business the request belongs to. Becomes `app.tenant_id` in PostgreSQL. */
  tenantId: string;
  /** The staff member making the request, if any. Becomes `app.user_id` (used for audit columns). */
  userId?: string;
}

/**
 * Holds the TenantContext for the duration of one request, without passing it through every function.
 *
 * It uses Node's AsyncLocalStorage: everything that runs as part of the same request (even after
 * `await`) can read the same value, and concurrent requests never see each other's value.
 */
const storage = new AsyncLocalStorage<TenantContext>();

/** UUID format check. The context ends up in SQL settings, so it must be exactly a UUID. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throws if the value is not a UUID. Used before any id is sent to the database as a setting. */
export function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
}

/** Run `callback` with the given tenant context available to everything it calls. */
export function runWithTenantContext<T>(context: TenantContext, callback: () => T): T {
  assertUuid(context.tenantId, 'tenantId');
  if (context.userId !== undefined) assertUuid(context.userId, 'userId');
  return storage.run(context, callback);
}

/** The current context, or undefined when called outside a tenant-scoped request. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}
