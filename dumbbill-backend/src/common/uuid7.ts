import { randomBytes } from 'node:crypto';

/**
 * A new UUID version 7: a normal UUID whose first 48 bits are the current time in milliseconds.
 *
 * Why version 7 and not the random version 4: ids that grow with time keep database indexes compact and
 * fast, and rows sort in creation order. Prisma already generates them for most tables (`@default(uuid(7))`).
 * We need our own only where the id must be known BEFORE the row is written, as with a new business at signup
 * (its id becomes the tenant context for the transaction that creates it).
 *
 * Layout (RFC 9562): 48-bit time | 4-bit version (7) | 12 random | 2-bit variant (10) | 62 random.
 */
export function uuid7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  // First 6 bytes: milliseconds since 1970, big-endian.
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
