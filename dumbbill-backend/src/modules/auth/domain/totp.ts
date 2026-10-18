import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Authenticator-app codes ("two-step login"), implemented from the public standards:
 *   RFC 4226 (HOTP: a code from a secret and a counter) and RFC 6238 (TOTP: the counter is the time).
 * It works with Google Authenticator, Microsoft Authenticator, Authy, 1Password and similar apps.
 *
 * The code is small and standard; `test/unit/totp.spec.ts` checks it against the official test values
 * published in the RFCs, which is why it is safe to own instead of depending on a library.
 */

/** A code is valid for 30 seconds. */
export const TOTP_STEP_SECONDS = 30;
/** Codes have 6 digits (what authenticator apps expect by default). */
const DIGITS = 6;
/** How many 30-second steps either side of "now" are accepted, to forgive small clock differences on the phone. */
const ALLOWED_DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode bytes as Base32 (the text format authenticator apps use for secrets). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decode Base32 text back to bytes. Spaces, dashes and lower case are tolerated; other characters throw. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Not a valid Base32 secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new random secret: 20 bytes (160 bits), as recommended by RFC 4226, returned as Base32 text. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The HOTP code for one counter value (RFC 4226 section 5.3). */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  // "Dynamic truncation": pick 4 bytes from a spot chosen by the last nibble, drop the top bit.
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The 30-second time step number a moment falls into. */
export function timeStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** The TOTP code for a moment in time (RFC 6238). Exposed mainly for tests. */
export function totpAt(secretBase32: string, at: Date, digits = DIGITS): string {
  return hotp(base32Decode(secretBase32), timeStep(at), digits);
}

/**
 * Check a code typed by the user.
 *
 * Returns the time step it matched, or null. The caller stores that step and passes it back as
 * `lastUsedStep` next time, so the SAME code cannot be used twice (otherwise someone who watched you
 * type it could reuse it within the next 30-90 seconds).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  now: Date,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = timeStep(now);
  for (let drift = -ALLOWED_DRIFT_STEPS; drift <= ALLOWED_DRIFT_STEPS; drift++) {
    const step = current + drift;
    if (lastUsedStep !== null && step <= lastUsedStep) continue; // already used (or older than one used)
    const expected = Buffer.from(hotp(secret, step));
    // Constant-time comparison, so response time does not reveal how many digits were right.
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** The `otpauth://` link that authenticator apps read from a QR code. */
export function otpAuthUri(secretBase32: string, accountEmail: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ---------------------------------------------------------------------------------------------
// Recovery codes: a few one-time codes the person keeps safe, for the day the phone is lost.
// ---------------------------------------------------------------------------------------------

/** How many recovery codes are created. */
export const RECOVERY_CODE_COUNT = 8;
/** No look-alike characters (0/O, 1/I/L), so a code read from paper is not mistyped. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Make the recovery codes, formatted like `K7F2M-9QXPA`. They are shown once and only hashes are stored. */
export function generateRecoveryCodes(): string[] {
  const part = (): string =>
    Array.from({ length: 5 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join(
      '',
    );
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => `${part()}-${part()}`);
}

/** Normalise what a person typed (case, spaces) and hash it, for storing or comparing. */
export function hashRecoveryCode(code: string): string {
  const normal = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHash('sha256').update(`recovery:${normal}`).digest('hex');
}
