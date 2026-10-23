import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { SecretCipher } from './crypto/secret-cipher.service';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpAuthUri,
  verifyTotp,
} from './domain/totp';
import { PasswordHasher } from './password/password-hasher.service';
import { RateLimiter } from './rate-limit/rate-limiter.service';
import { TotpCodeDto, TotpDisableDto } from './dto/auth-requests.dto';

/** What the second step of sign-in found. */
export type FactorResult = 'ok' | 'missing' | 'invalid';

/**
 * Two-step login with an authenticator app (TOTP), optional for every staff account.
 *
 * Switching it on takes two steps so a person cannot lock themselves out by scanning a code wrongly:
 *   1. `setup`   creates a secret and stores it (encrypted) but does NOT switch anything on;
 *   2. `enable`  switches it on only after the person proves their app shows the right code,
 *                and hands over one-time recovery codes for the day the phone is lost.
 * Nothing about a half-finished setup affects sign-in (login only asks for a code when `totp_enabled_at` is set).
 *
 * Mandatory two-step for the Super Admin is added with that role in Phase 4.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly cipher: SecretCipher,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Start setup: create a fresh secret (replacing any unfinished one). Fails if already switched on. */
  async setup(userId: string, brand: string): Promise<{ secret: string; otpAuthUri: string }> {
    await this.limiter.hit('totp:user', userId, 10, 15 * 60);
    return this.tenantTx.run(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.totpEnabledAt) {
        throw new DomainError(
          'CONFLICT',
          'Two-step login is already switched on. Switch it off first to set it up again.',
        );
      }
      const secret = generateTotpSecret();
      await tx.user.update({
        where: { id: userId },
        data: { totpSecretEnc: this.cipher.encrypt(secret) },
      });
      return { secret, otpAuthUri: otpAuthUri(secret, user.email, brand) };
    });
  }

  /**
   * Finish setup: check the password and the first code, switch two-step on, and return the recovery codes (shown once).
   * The password is required because switching on a second factor the owner does not hold would lock them out; a stolen
   * access token alone must not be able to do that.
   */
  async enable(userId: string, input: TotpCodeDto, info: RequestInfo): Promise<string[]> {
    await this.limiter.hit('totp:user', userId, 10, 15 * 60);
    const recoveryCodes = generateRecoveryCodes();
    await this.tenantTx.run(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.totpEnabledAt)
        throw new DomainError('CONFLICT', 'Two-step login is already switched on.');
      if (!user.totpSecretEnc) {
        throw new DomainError('BUSINESS_RULE_VIOLATION', 'Start the setup first to get a secret.');
      }
      const passwordOk = user.passwordHash
        ? (await this.hasher.verify(user.passwordHash, input.currentPassword)).valid
        : false;
      if (!passwordOk) throw new DomainError('INVALID_CREDENTIALS', 'The password is not correct.');
      const step = verifyTotp(
        this.cipher.decrypt(user.totpSecretEnc),
        input.code,
        this.clock.now(),
        null,
      );
      if (step === null)
        throw new DomainError(
          'INVALID_TOTP_CODE',
          'That code is not right. Check the time on your phone and try again.',
        );
      await tx.user.update({
        where: { id: userId },
        data: {
          totpEnabledAt: this.clock.now(),
          totpLastStep: BigInt(step),
          totpRecoveryHashes: recoveryCodes.map(hashRecoveryCode),
        },
      });
      await this.audit.write(
        tx,
        { action: 'auth.totp_enabled', actorUserId: userId, entity: 'user', entityId: userId },
        info,
      );
    });
    return recoveryCodes;
  }

  /** Switch two-step off. Needs the password AND a current code (or recovery code), so a stolen session cannot do it. */
  async disable(userId: string, input: TotpDisableDto, info: RequestInfo): Promise<void> {
    await this.limiter.hit('totp:user', userId, 10, 15 * 60);
    await this.tenantTx.run(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.totpEnabledAt)
        throw new DomainError('BUSINESS_RULE_VIOLATION', 'Two-step login is not switched on.');
      const passwordOk = user.passwordHash
        ? (await this.hasher.verify(user.passwordHash, input.password)).valid
        : false;
      if (!passwordOk) throw new DomainError('INVALID_CREDENTIALS', 'The password is not correct.');
      const factor = await this.checkFactor(tx, userId, {
        totpCode: input.code,
        recoveryCode: input.code,
      });
      if (factor !== 'ok') throw new DomainError('INVALID_TOTP_CODE', 'That code is not right.');
      await tx.user.update({
        where: { id: userId },
        data: {
          totpSecretEnc: null,
          totpEnabledAt: null,
          totpLastStep: null,
          totpRecoveryHashes: [],
        },
      });
      await this.audit.write(
        tx,
        { action: 'auth.totp_disabled', actorUserId: userId, entity: 'user', entityId: userId },
        info,
      );
    });
  }

  /**
   * The second step of sign-in, inside the login transaction.
   * `missing` = no code was sent (the app should ask for one); `invalid` = wrong, reused, or unknown code.
   */
  async checkFactor(
    tx: TenantTransaction,
    userId: string,
    input: { totpCode?: string; recoveryCode?: string },
  ): Promise<FactorResult> {
    if (!input.totpCode && !input.recoveryCode) return 'missing';
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecretEnc) return 'invalid';

    if (input.totpCode) {
      const step = verifyTotp(
        this.cipher.decrypt(user.totpSecretEnc),
        input.totpCode,
        this.clock.now(),
        user.totpLastStep === null ? null : Number(user.totpLastStep),
      );
      if (step !== null) {
        // Remember the step so the same code cannot be used again. The condition makes it atomic: if the same
        // code is submitted twice at once, only one request changes the row.
        const claimed = await tx.user.updateMany({
          where: {
            id: userId,
            OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }],
          },
          data: { totpLastStep: BigInt(step) },
        });
        return claimed.count === 1 ? 'ok' : 'invalid';
      }
    }

    if (input.recoveryCode) {
      const hash = hashRecoveryCode(input.recoveryCode);
      if (user.totpRecoveryHashes.includes(hash)) {
        // A recovery code works once: remove it. This is ONE SQL statement that removes exactly this code from
        // whatever the list is at that moment. (Writing back a list computed earlier would be wrong: two codes
        // used at the same instant would each write back a stale list, and one used code could come back to life.)
        // The condition also makes the same code lose the race if it is submitted twice at once.
        const removed = await tx.$executeRaw`
          UPDATE users
          SET totp_recovery_hashes = array_remove(totp_recovery_hashes, ${hash})
          WHERE id = ${userId}::uuid AND ${hash} = ANY(totp_recovery_hashes)`;
        return removed === 1 ? 'ok' : 'invalid';
      }
    }
    return 'invalid';
  }
}
