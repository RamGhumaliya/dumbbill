import { randomBytes } from 'node:crypto';

/**
 * Request ids: the short reference that ties together everything that happened during one API call.
 * The same id appears in the `X-Request-Id` response header, in the error body (`requestId`), in
 * every log line of that request and in Sentry. A user who sees "Ref: 01JA..." in an error message
 * can quote it, and we can find the full story in seconds.
 */

/** Crockford base32: digits and letters without the easily confused I, L, O, U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Create a new id: 26 characters, ULID format. The first 10 characters are the time in
 * milliseconds, so ids sort by time and are easy to find in logs; the other 16 are random.
 */
export function newRequestId(now: number = Date.now()): string {
  let time = '';
  let remaining = now;
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  const random = randomBytes(16);
  let suffix = '';
  for (let i = 0; i < 16; i += 1) {
    suffix += ALPHABET[(random[i] ?? 0) % 32];
  }
  return time + suffix;
}

/**
 * Callers (the web and mobile apps, or a load balancer) may send their own `X-Request-Id` so one
 * id follows the whole journey. We accept it only if it looks harmless: it ends up in logs and
 * response headers, so odd characters or huge values must never get through.
 */
const ACCEPTABLE_INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Use the caller's id if it is safe, otherwise make a new one. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  if (candidate && ACCEPTABLE_INCOMING_ID.test(candidate)) return candidate;
  return newRequestId();
}
