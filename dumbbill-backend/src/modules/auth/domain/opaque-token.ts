import { createHash, randomBytes } from 'node:crypto';
import { assertUuid } from '../../tenancy/tenant-context';

/**
 * Helpers for the random tokens we hand out: refresh tokens and the one-time tokens in emails
 * (verify address, reset password).
 *
 * WHAT A TOKEN LOOKS LIKE:   `<tenantId>.<secret>`
 *   - `secret` is 32 random bytes (256 bits), so it cannot be guessed.
 *   - Only a one-way hash of the secret is stored in the database. If the database leaks, the leaked
 *     hashes cannot be turned back into working tokens (a plain SHA-256 is enough here because the
 *     secret is already random and long; slow password hashing is only needed for human-chosen passwords).
 *   - `tenantId` is written in front on purpose. All our tables are protected by row-level security, which
 *     needs to know the business before it shows any row. A token arrives BEFORE we know who it belongs to,
 *     so the business id travels inside it. A forged or wrong id simply finds nothing: the secret hash
 *     must still match a row of that business.
 */

/** A token split into its two parts. */
export interface ParsedToken {
  tenantId: string;
  secret: string;
}

/** Make a new random secret (URL-safe, so it can sit in a link or a cookie without escaping). */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** One-way fingerprint of a secret. This is what the database stores and looks up. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Join the business id and the secret into the string given to the client. */
export function formatToken(tenantId: string, secret: string): string {
  assertUuid(tenantId, 'tenantId');
  return `${tenantId}.${secret}`;
}

/**
 * Split a token presented by a client. Returns null for anything that is not shaped like one of ours,
 * so callers can answer "invalid token" without touching the database.
 */
export function parseToken(token: unknown): ParsedToken | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const match =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(
      token,
    );
  return match ? { tenantId: match[1]!.toLowerCase(), secret: match[2]! } : null;
}
