import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import { DomainError } from '../../../common/errors/domain-error';
import { FAILURE_MEMORY_SECONDS, lockSecondsForFailures } from '../domain/lockout';
import { EphemeralStore } from '../store/ephemeral-store';

/** Injection token for the development switch that turns all limits off. */
export const RATE_LIMIT_DISABLED = 'RATE_LIMIT_DISABLED';

/**
 * Brakes against guessing and flooding: request limits per visitor and per target, and the
 * wrong-password lockout.
 *
 * FAILS OPEN, on purpose: if Redis is down, sign-in keeps working (and an error is logged and reported)
 * rather than locking every shop out of its own POS. The password hashing and the strong secrets still
 * protect accounts; only the extra brake is missing until Redis returns. This trade-off is in ADR 006.
 *
 * Keys never contain an email address or IP in clear text: they are hashed first, so even a dump of
 * the Redis data reveals no personal data.
 */
@Injectable()
export class RateLimiter {
  constructor(
    private readonly store: EphemeralStore,
    private readonly logger: Logger,
    /** Development switch (RATE_LIMIT_DISABLED): every limit and the lockout are skipped. Never on in production. */
    @Optional() @Inject(RATE_LIMIT_DISABLED) private readonly disabled: boolean = false,
  ) {
    if (disabled)
      this.logger.warn({
        msg: 'RATE_LIMIT_DISABLED is on: no rate limits or lockouts. Development only.',
      });
  }

  /** A short one-way fingerprint of an email or IP, used inside keys. */
  private fingerprint(value: string): string {
    return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 24);
  }

  /** Run a store call; if the store is unreachable, log it and carry on as if nothing was limited. */
  private async failOpen<T>(fallback: T, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      this.logger.error({
        msg: 'Rate-limit store unavailable, limits are not applied',
        err: error,
      });
      return fallback;
    }
  }

  /**
   * Count one request against a limit and refuse it when the limit is passed.
   *
   * @param bucket   what is being limited, for example `login:ip`
   * @param subject  who it is counted against (an IP address or an email); hashed before use
   * @param max      requests allowed per window
   * @param windowSeconds the length of the window
   * @throws DomainError RATE_LIMITED (HTTP 429) with a `Retry-After` header
   */
  async hit(bucket: string, subject: string, max: number, windowSeconds: number): Promise<void> {
    if (this.disabled) return;
    const result = await this.failOpen(null, () =>
      this.store.increment(`rl:${bucket}:${this.fingerprint(subject)}`, windowSeconds),
    );
    if (result && result.count > max) throw this.tooMany(result.ttlSeconds);
  }

  /** Throws RATE_LIMITED when this email is currently locked after too many wrong passwords. */
  async assertNotLocked(email: string): Promise<void> {
    if (this.disabled) return;
    const remaining = await this.failOpen(0, () =>
      this.store.remainingSeconds(`lock:${this.fingerprint(email)}`),
    );
    if (remaining > 0) throw this.tooMany(remaining);
  }

  /**
   * Record a wrong password (or wrong code) for this email. Counts for unknown emails too: if only real
   * accounts could be locked, the lockout itself would tell an attacker which emails exist.
   */
  async recordLoginFailure(email: string): Promise<void> {
    if (this.disabled) return;
    await this.failOpen(undefined, async () => {
      const key = this.fingerprint(email);
      const { count } = await this.store.increment(`fail:${key}`, FAILURE_MEMORY_SECONDS);
      const lock = lockSecondsForFailures(count);
      if (lock > 0) await this.store.set(`lock:${key}`, lock);
    });
  }

  /** Forget earlier failures after a successful sign-in. */
  async clearLoginFailures(email: string): Promise<void> {
    await this.failOpen(undefined, async () => {
      const key = this.fingerprint(email);
      await this.store.delete(`fail:${key}`);
      await this.store.delete(`lock:${key}`);
    });
  }

  private tooMany(retryAfterSeconds: number): DomainError {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    return new DomainError(
      'RATE_LIMITED',
      `Too many attempts. Please wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`,
      undefined,
      { 'Retry-After': String(seconds) },
    );
  }
}
