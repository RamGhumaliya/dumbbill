import { FieldError } from '../../../common/errors/domain-error';

/**
 * The password rules (docs/03-engineering/security.md section 2):
 *   - at least 10 characters, at most 128;
 *   - NO "must contain a symbol and a capital" rules: those push people to predictable passwords
 *     like `Password1!`. Length and not-being-guessable matter more;
 *   - not an obviously common or personal password.
 * The "has this password appeared in a data breach?" check is separate (breach-checker.ts) because it
 * needs the network.
 */

export const PASSWORD_MIN_LENGTH = 10;
/** The upper limit stops someone sending a huge "password" to make the server waste time hashing it. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Very common passwords that are at least 10 characters long (shorter ones are already rejected by length).
 * This is a small built-in list so the check also works with no internet; the breach list covers the rest.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '1234567890',
  '0123456789',
  '9876543210',
  '0987654321',
  '12345678910',
  '123456789012',
  'qwertyuiop',
  'qwertyuiop1',
  'qwerty1234',
  'qwerty12345',
  'qwertyuiopasdfghjkl',
  'asdfghjkl1',
  'asdfghjklq',
  'zxcvbnm123',
  'abcdefghij',
  'abcdefghijk',
  'abcd123456',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'password1!',
  'passw0rd123',
  'iloveyou12',
  'iloveyou123',
  'iloveyou1234',
  'welcome123',
  'welcome1234',
  'welcome12345',
  'letmein123',
  'letmein1234',
  'administrator',
  'admin12345',
  'admin123456',
  'adminadmin',
  'changeme123',
  'changeme12',
  'trustno1234',
  'dragon1234',
  'monkey1234',
  'football123',
  'baseball123',
  'superman123',
  'princess123',
  'sunshine123',
  'whatever123',
  'internet123',
  'india12345',
  'india123456',
  'mumbai12345',
  'delhi12345',
  'krishna123',
  'ganesh1234',
  'jaishreeram',
  'omnamahshivaya',
  'sairam12345',
  'mypassword1',
  'mypassword12',
  'protein1234',
  'supplement1',
  'gym1234567',
  'fitness1234',
  'dumbbill123',
  'dumbbill1234',
  '1q2w3e4r5t',
  '1qaz2wsx3e',
  '1q2w3e4r5t6y',
  'q1w2e3r4t5',
  'qazwsxedcrfv',
  'zaq12wsxcde',
  '11111111111',
  '1111111111',
  '0000000000',
  '1212121212',
  '1234512345',
  '1122334455',
  'aaaaaaaaaa',
  'abcabcabcabc',
  'password00',
  'p@ssw0rd123',
  'p@ssword123',
]);

/** True when every character is the same (`aaaaaaaaaaaa`) or the text is a simple run (`abcdefghijkl`, `123456789012`). */
function isTrivialPattern(password: string): boolean {
  if (new Set(password).size <= 2) return true;
  const codes = Array.from(password, (c) => c.charCodeAt(0));
  const steps = new Set(codes.slice(1).map((code, i) => code - codes[i]!));
  return steps.size === 1 && (steps.has(1) || steps.has(-1));
}

/** What the rules need to know besides the password, to catch "my email as my password". */
export interface PasswordContext {
  email?: string;
  fullName?: string;
  businessName?: string;
  /** The product name, which people often put in passwords. */
  brandName?: string;
}

/**
 * Check a new password. Returns a list of plain-English problems (empty = acceptable).
 * Each problem is also a FieldError so apps can show it under the password box.
 */
export function checkPasswordPolicy(password: string, context: PasswordContext = {}): FieldError[] {
  const problems: string[] = [];
  const lower = password.toLowerCase();

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  if (COMMON_PASSWORDS.has(lower) || isTrivialPattern(password)) {
    problems.push('This password is too common or too predictable. Try a few unrelated words.');
  }

  // Passwords built from the person's own details are the first thing an attacker tries.
  const personal = [
    context.email?.toLowerCase(),
    context.email?.split('@')[0]?.toLowerCase(),
    context.fullName?.toLowerCase().replace(/\s+/g, ''),
    context.businessName?.toLowerCase().replace(/\s+/g, ''),
    context.brandName?.toLowerCase(),
  ].filter((value): value is string => !!value && value.length >= 4);
  if (personal.some((value) => lower.includes(value))) {
    problems.push('Do not use your name, email or business name in the password.');
  }

  return problems.map((message) => ({ field: 'password', message }));
}
