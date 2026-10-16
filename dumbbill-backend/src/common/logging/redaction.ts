/**
 * Keeps secrets and private business data out of logs.
 *
 * Logs are copied to other systems (log search, backups, support tools) and read by more people
 * than the database is, so they must never contain passwords, login tokens, or things a cashier
 * is not allowed to see, such as purchase cost and profit.
 *
 * This runs on EVERY log call: any object field whose name is on the list below is replaced,
 * at any depth, whatever code logged it. That makes it a safety net for mistakes such as
 * `logger.info({ body })` with a password inside.
 */

/** Placeholder written instead of a secret value. */
export const REDACTED = '[redacted]';

/**
 * Field names that must never appear in a log, compared case-insensitively and ignoring `_` and `-`
 * (so `passwordHash`, `password_hash` and `PASSWORD-HASH` all match).
 */
const SECRET_KEYS = [
  // credentials and sessions
  'password',
  'passwordhash',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'cookie',
  'setcookie',
  'pin',
  'otp',
  'secret',
  'clientsecret',
  'apikey',
  'privatekey',
  'signature',
  // business-confidential: cashiers must never see these, so logs must not carry them either
  'unitcost',
  'purchasecost',
  'wac',
  'costatsale',
  'cogs',
  'profit',
  'grossprofit',
  'margin',
] as const;

/** Personal data that is kept in a shortened form (a hint for debugging, not the full value). */
const MASKED_KEYS = ['email', 'phone', 'mobile'] as const;

const SECRET_SET: ReadonlySet<string> = new Set(SECRET_KEYS);
const MASKED_SET: ReadonlySet<string> = new Set(MASKED_KEYS);

/** Lower-case a key and drop `_` and `-` so spelling variants compare equal. */
function normalise(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/** Any name ENDING in one of these is treated as secret too, so `csrfToken` or `dbPassword` are caught. */
const SECRET_SUFFIXES = ['password', 'token', 'secret'] as const;

/** Is this field name on the secret list? Exported so tests and tools use the same rule. */
export function isSecretKey(key: string): boolean {
  const name = normalise(key);
  return SECRET_SET.has(name) || SECRET_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Is this field a piece of personal data that should be shown only in shortened form? */
export function isMaskedKey(key: string): boolean {
  return MASKED_SET.has(normalise(key));
}

/** "ram@example.com" -> "r***@example.com"; "9876543210" -> "******3210". */
export function maskPersonalValue(key: string, value: unknown): string {
  const text = String(value);
  if (normalise(key) === 'email') {
    const at = text.indexOf('@');
    return at > 0 ? `${text[0]}***${text.slice(at)}` : REDACTED;
  }
  return text.length > 4 ? `${'*'.repeat(text.length - 4)}${text.slice(-4)}` : REDACTED;
}

const MAX_DEPTH = 8;

/** Only plain objects and arrays are walked. Class instances (requests, sockets, streams) are left alone. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Return a copy of `value` with secrets replaced and personal data shortened, at any depth.
 * The original is never changed. Walks at most 8 levels deep to stay fast and safe on odd shapes.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (isSecretKey(key)) {
      result[key] = REDACTED;
    } else if (
      isMaskedKey(key) &&
      inner !== null &&
      inner !== undefined &&
      typeof inner !== 'object'
    ) {
      result[key] = maskPersonalValue(key, inner);
    } else {
      result[key] = scrub(inner, depth + 1);
    }
  }
  return result;
}

/**
 * Find any secret field that still holds a real value in a parsed log line.
 * Used by tests (and available for checking saved log samples). Returns the offending paths.
 */
export function findLeakedSecrets(value: unknown, path = '', depth = 0): string[] {
  if (depth > MAX_DEPTH + 2) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findLeakedSecrets(item, `${path}[${index}]`, depth + 1));
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    const here = path ? `${path}.${key}` : key;
    if (isSecretKey(key)) return inner === REDACTED ? [] : [here];
    return findLeakedSecrets(inner, here, depth + 1);
  });
}
