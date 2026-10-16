/**
 * Request ids made by the web app.
 *
 * Every API call carries an `X-Request-Id` header. The server writes the same id on every log line
 * and error of that call. Creating the id here, BEFORE sending, means that even when the network fails
 * and no response ever comes back, the user still has a reference to quote to support.
 *
 * Format: 26 characters (ULID style): 10 characters of time, then 16 random. Same format as the server's.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newRequestId(now: number = Date.now()): string {
  let time = '';
  let remaining = now;
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  // crypto.getRandomValues exists in every browser and in Node, and is cryptographically random.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let suffix = '';
  for (const byte of bytes) suffix += ALPHABET[byte % 32];
  return time + suffix;
}
