import { createHash } from 'node:crypto';
import { Logger } from 'nestjs-pino';

/**
 * "Has this password appeared in a known data breach?"
 *
 * Attackers try passwords leaked from other websites against every service ("credential stuffing"). A password
 * that is already in a leak list is unsafe however long it looks, so we refuse it when it is chosen.
 */
export abstract class BreachChecker {
  /** True when the password is known to be in a breach. */
  abstract isBreached(password: string): Promise<boolean>;
}

/** Used when the check is switched off (tests, offline development). */
export class NoBreachChecker extends BreachChecker {
  async isBreached(): Promise<boolean> {
    return false;
  }
}

/**
 * Uses the free "Pwned Passwords" range service (haveibeenpwned.com).
 *
 * PRIVACY: the password never leaves our server. We send only the first 5 characters of its SHA-1 hash;
 * the service returns every known hash starting with those 5 characters (hundreds), and WE look for the
 * rest locally. The service cannot tell which password was checked ("k-anonymity").
 *
 * If the service is slow or unreachable we let the password through rather than blocking signup, and log a
 * warning. The built-in common-password list (password-policy.ts) still applies.
 */
export class HibpBreachChecker extends BreachChecker {
  constructor(
    private readonly logger: Logger,
    private readonly timeoutMs = 2000,
  ) {
    super();
  }

  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        // "Add-Padding" makes the reply size constant, so even the size reveals nothing.
        headers: { 'Add-Padding': 'true', 'User-Agent': 'dumbbill-password-check' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`Breach service answered ${response.status}`);
      const text = await response.text();
      return text.split('\n').some((line) => {
        const [hashSuffix, count] = line.trim().split(':');
        // Padding entries have a count of 0 and are not real leaks.
        return hashSuffix === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.logger.warn({ msg: 'Password breach check skipped: service unavailable', err: error });
      return false;
    }
  }
}
