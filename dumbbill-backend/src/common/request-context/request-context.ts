import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Information about the request currently being handled, available anywhere in the code
 * without passing it around (logger, error filter, Sentry reporting).
 *
 * It uses Node's AsyncLocalStorage: everything that runs as part of one request, even after an
 * `await`, reads the same value, and two requests at the same time never see each other's.
 *
 * (The business/tenant identity is kept separately in tenancy/tenant-context.ts.)
 */
export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `callback` with `context` as the current request. Used by the request middleware. */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

/** The current request's context, or undefined outside a request (start-up code, background jobs). */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
