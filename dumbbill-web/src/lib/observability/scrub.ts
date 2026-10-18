/**
 * Removes secrets from what is sent to the error tracker.
 *
 * Why this exists: some of our addresses carry a one-time secret in the query string, for example
 * `/reset-password?token=...` and `/verify-email?token=...`. An error report normally records the address of the page
 * and the pages visited just before ("breadcrumbs"). A reset link that ended up in a third-party dashboard would be a
 * live key to someone's account for as long as it is valid. So every address is cut down to its path before it leaves
 * the browser: `/reset-password?token=abc#x` becomes `/reset-password`.
 *
 * These are plain functions with no dependencies, so they are easy to test and are used by the Sentry settings.
 */

/** An address with the query string (`?...`) and the anchor (`#...`) removed. Non-strings are returned unchanged. */
export function stripQueryAndHash<T>(value: T): T {
  if (typeof value !== 'string') return value;
  return value.split(/[?#]/)[0] as T;
}

/** Fields of a breadcrumb or event that hold an address. */
const ADDRESS_FIELDS = ['url', 'from', 'to'] as const;

/** Remove query strings and anchors from the address fields of an object, at one level (breadcrumb `data`). */
function scrubAddresses(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const field of ADDRESS_FIELDS) {
    if (field in data) data[field] = stripQueryAndHash(data[field]);
  }
}

/** The shapes this file touches, written out so no dependency on the Sentry types is needed. */
interface EventLike {
  request?: {
    url?: string;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  breadcrumbs?: Array<{ data?: Record<string, unknown>; message?: string }>;
  transaction?: string;
  user?: unknown;
}

/** Make an error event safe to send: no cookies, headers, bodies, user, query strings or anchors. */
export function scrubEvent<T extends EventLike>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    event.request.url = stripQueryAndHash(event.request.url);
  }
  delete event.user;
  event.transaction = stripQueryAndHash(event.transaction);
  for (const breadcrumb of event.breadcrumbs ?? []) scrubAddresses(breadcrumb.data);
  return event;
}

/** Make a breadcrumb (a note about something that happened before an error) safe to keep. */
export function scrubBreadcrumb<T extends { data?: Record<string, unknown> }>(breadcrumb: T): T {
  scrubAddresses(breadcrumb.data);
  return breadcrumb;
}
