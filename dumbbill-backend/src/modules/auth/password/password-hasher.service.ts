import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { createHmac } from 'node:crypto';
import { Logger } from 'nestjs-pino';

/**
 * Hashing and checking passwords.
 *
 * We never store a password. We store a hash made with Argon2id, a deliberately slow, memory-hungry
 * function that makes guessing passwords from a stolen database very expensive.
 *
 * THE PEPPER: before hashing, the password is mixed (HMAC-SHA256) with a server-side secret called a pepper
 * that is NOT in the database. A thief who copies only the database then cannot even start guessing.
 * Peppers are VERSIONED so one can be replaced without locking people out: the stored value starts with the
 * version used (`v2:$argon2id$...`). New passwords use the newest pepper; an old one keeps working and the
 * password is quietly re-hashed with the newest pepper the next time the person signs in (`needsRehash`).
 *
 * Settings: PASSWORD_PEPPERS, ARGON2_MEMORY_KIB, ARGON2_TIME_COST (see config/env.validation.ts).
 */

/** Result of checking a password against a stored hash. */
export interface PasswordCheck {
  /** The password is right. */
  valid: boolean;
  /** Right, but the stored hash uses an old pepper or weaker settings, so store a fresh one now. */
  needsRehash: boolean;
}

/** Used in development when no pepper is configured. Production refuses to start without real ones. */
const DEV_PEPPERS = '1:dev-only-pepper-never-use-in-production-0000';

@Injectable()
export class PasswordHasher {
  /** version -> secret */
  private readonly peppers = new Map<number, string>();
  private readonly currentVersion: number;
  private readonly memoryKib: number;
  private readonly timeCost: number;
  /** A real hash of a random password, compared against when the email is unknown (see `burnTime`). */
  private dummyHash: Promise<string> | undefined;

  constructor(config: ConfigService, logger: Logger) {
    const configured = config.get<string>('PASSWORD_PEPPERS');
    if (!configured) {
      logger.warn({
        msg: 'PASSWORD_PEPPERS is not set: using a development pepper. Never do this in production.',
      });
    }
    for (const pair of (configured || DEV_PEPPERS).split(',')) {
      const separator = pair.indexOf(':');
      const version = Number(pair.slice(0, separator));
      if (!Number.isInteger(version) || version < 1 || separator < 1) {
        throw new Error('PASSWORD_PEPPERS must look like "1:secret" or "1:secret,2:secret".');
      }
      this.peppers.set(version, pair.slice(separator + 1));
    }
    this.currentVersion = Math.max(...this.peppers.keys());
    this.memoryKib = config.getOrThrow<number>('ARGON2_MEMORY_KIB');
    this.timeCost = config.getOrThrow<number>('ARGON2_TIME_COST');
  }

  /** Mix the password with a pepper so the value that gets hashed is useless without the server secret. */
  private peppered(password: string, version: number): string {
    const secret = this.peppers.get(version);
    if (!secret) throw new Error(`Unknown pepper version ${version}.`);
    return createHmac('sha256', secret).update(password).digest('hex');
  }

  /** Hash a new password with the newest pepper. Returns the string to store in `users.password_hash`. */
  async hash(password: string): Promise<string> {
    const digest = await hash(this.peppered(password, this.currentVersion), {
      algorithm: Algorithm.Argon2id,
      memoryCost: this.memoryKib,
      timeCost: this.timeCost,
      parallelism: 1,
    });
    return `v${this.currentVersion}:${digest}`;
  }

  /** Check a password against a stored hash. Never throws for a wrong password or a malformed stored value. */
  async verify(stored: string, password: string): Promise<PasswordCheck> {
    const match = /^v(\d+):(\$argon2id\$.+)$/.exec(stored);
    if (!match || !this.peppers.has(Number(match[1]))) return { valid: false, needsRehash: false };
    const version = Number(match[1]);
    // A malformed stored hash makes `verify` throw; that must read as "wrong password", never as a crash.
    const valid = await verify(match[2]!, this.peppered(password, version)).catch(() => false);
    if (!valid) return { valid: false, needsRehash: false };
    const params = /\$m=(\d+),t=(\d+),/.exec(match[2]!);
    const weaker =
      !params || Number(params[1]) !== this.memoryKib || Number(params[2]) !== this.timeCost;
    return { valid: true, needsRehash: version !== this.currentVersion || weaker };
  }

  /**
   * Do the same amount of work as a real check, then say nothing.
   *
   * When someone logs in with an email we do not know, there is no hash to verify. If we answered at once,
   * "fast = no such account, slow = wrong password" would let an attacker list which emails have accounts.
   * So the unknown-email path calls this to spend the same time.
   */
  async burnTime(password: string): Promise<void> {
    this.dummyHash ??= this.hash('not-a-real-account-password');
    await this.verify(await this.dummyHash, password);
  }
}
