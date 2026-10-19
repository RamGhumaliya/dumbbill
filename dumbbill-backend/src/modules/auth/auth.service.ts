import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { uuid7 } from '../../common/uuid7';
import { AuditService, RequestInfo } from '../audit/audit.service';
import {
  alreadyRegisteredEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../mail/auth-emails';
import { MailMessage, Mailer } from '../mail/mailer';
import { LoginLookup } from '../tenancy/login-lookup.service';
import { TenantTx } from '../tenancy/tenant-tx.service';
import { AuthenticatedUser } from './auth.types';
import { hashSecret, parseToken } from './domain/opaque-token';
import {
  AccessSummaryDto,
  AuthTenantDto,
  AuthUserDto,
  LoginResponseDto,
  MeResponseDto,
  RefreshResponseDto,
} from './dto/auth-responses.dto';
import { ChangePasswordDto, LoginDto, ResetPasswordDto, SignupDto } from './dto/auth-requests.dto';
import { PasswordRules } from './password/password-rules.service';
import { AuthTokenService } from './auth-token.service';
import { AccessService } from '../permissions/access.service';
import { createDefaultRolesAndBranch } from '../permissions/default-roles';
import { PasswordHasher } from './password/password-hasher.service';
import { RateLimiter } from './rate-limit/rate-limiter.service';
import { SessionService } from './session/session.service';
import { AccessTokenService } from './tokens/access-token.service';
import { TwoFactorService } from './two-factor.service';

/** Email verification links work for 24 hours (US-AUTH-01). */
const VERIFICATION_TOKEN_HOURS = 24;
/** Password reset links work for 30 minutes and only once (US-AUTH-03). */
const RESET_TOKEN_MINUTES = 30;

/** The same sentence is returned whether or not an account exists, so the answer reveals nothing. */
const NEUTRAL_MESSAGE = 'If this email can be used, a message is on its way.';

/** Everything a successful sign-in produces. The controller decides how the refresh token travels. */
export interface SignInResult {
  body: LoginResponseDto;
  /** Always set here; for WEB clients the controller moves it into a cookie and removes it from the body. */
  refreshToken: string;
  sessionId: string;
}

/**
 * The account lifecycle: sign up, verify email, sign in, renew, sign out, forgot and change password.
 *
 * Five rules run through all of it (see ADR 006 and docs/03-engineering/security.md section 2):
 *  1. ENUMERATION-SAFE. Anything a stranger can reach (signup, login, forgot password, resend) answers the same
 *     way and takes about the same time whether the email has an account or not. Otherwise those pages become a
 *     free tool for finding out who uses the product.
 *  2. BRAKES. Every public endpoint is rate limited, and wrong passwords lock the account for growing intervals.
 *  3. ONE-TIME TOKENS. Emailed links work once, expire, and only their hash is stored.
 *  4. SESSIONS DIE WITH THE PASSWORD. Changing or resetting a password ends the other sessions.
 *  5. AUDITED. Sign-ins, failures, resets and session changes are written to the audit log in the same
 *     transaction as the change itself.
 */
@Injectable()
export class AuthService {
  private readonly brand: string;
  private readonly webBaseUrl: string;

  constructor(
    config: ConfigService,
    private readonly tenantTx: TenantTx,
    private readonly lookup: LoginLookup,
    private readonly hasher: PasswordHasher,
    private readonly rules: PasswordRules,
    private readonly authTokens: AuthTokenService,
    private readonly accessService: AccessService,
    private readonly limiter: RateLimiter,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {
    this.brand = config.getOrThrow<string>('BRAND_NAME');
    this.webBaseUrl = config.getOrThrow<string>('WEB_BASE_URL').replace(/\/$/, '');
  }

  // ---------------------------------------------------------------------------------------------
  // Signup and email verification
  // ---------------------------------------------------------------------------------------------

  /**
   * Create a new business and its owner, then email a verification link.
   * Answers the same whether or not the email already had an account (an existing owner gets a different email
   * instead, see `alreadyRegisteredEmail`).
   */
  async signup(dto: SignupDto, info: RequestInfo): Promise<{ message: string }> {
    await this.limiter.hit('signup:ip', info.ip ?? 'unknown', 5, 60 * 60);
    await this.rules.assertAcceptable(dto.password, {
      email: dto.email,
      fullName: dto.ownerName,
      businessName: dto.businessName,
    });

    // Hash first, even if the email turns out to exist: the work done (and so the time taken) is the same.
    const passwordHash = await this.hasher.hash(dto.password);

    const existing = await this.lookup.findByEmail(dto.email);
    if (existing) {
      await this.sendAlreadyRegistered(existing.email, existing.fullName);
      return { message: NEUTRAL_MESSAGE };
    }

    // The business id must be known before the first row is written: it becomes the tenant context of the
    // very transaction that creates the business.
    const tenantId = uuid7();
    const userId = uuid7();
    let verificationToken: string;
    try {
      verificationToken = await this.tenantTx.runAs({ tenantId, userId }, async (tx) => {
        const plan = await tx.plan.findUnique({ where: { code: 'STARTER' } });
        if (!plan)
          throw new Error('Reference data missing: run `pnpm db:seed` (plan STARTER not found).');
        const trialEndsAt = new Date(
          this.clock.now().getTime() + plan.trialDays * 24 * 60 * 60 * 1000,
        );
        await tx.tenant.create({
          data: { id: tenantId, name: dto.businessName.trim(), planId: plan.id, trialEndsAt },
        });
        // The business starts with its three built-in roles and a first branch; the owner holds the Owner role.
        const { roleIds } = await createDefaultRolesAndBranch(tx, tenantId);
        await tx.user.create({
          data: {
            id: userId,
            tenantId,
            email: dto.email,
            passwordHash,
            fullName: dto.ownerName.trim(),
            status: 'ACTIVE',
            isOwner: true,
            roleId: roleIds.OWNER,
            passwordChangedAt: this.clock.now(),
          },
        });
        await this.audit.write(
          tx,
          { action: 'auth.signup', actorUserId: userId, entity: 'tenant', entityId: tenantId },
          info,
        );
        return this.authTokens.issue(
          tx,
          tenantId,
          userId,
          'EMAIL_VERIFICATION',
          VERIFICATION_TOKEN_HOURS * 60,
        );
      });
    } catch (error) {
      // Two signups with the same email at the very same moment: the database unique rule stops the second.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.sendAlreadyRegistered(dto.email, dto.ownerName);
        return { message: NEUTRAL_MESSAGE };
      }
      throw error;
    }

    await this.send(
      verificationEmail({
        to: dto.email,
        brand: this.brand,
        name: dto.ownerName.trim(),
        link: `${this.webBaseUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`,
        validHours: VERIFICATION_TOKEN_HOURS,
      }),
      'verification',
    );
    return { message: NEUTRAL_MESSAGE };
  }

  /** Confirm an email address with the token from the link. @throws INVALID_TOKEN when unknown, used or expired. */
  async verifyEmail(token: string, info: RequestInfo): Promise<void> {
    await this.limiter.hit('verify:ip', info.ip ?? 'unknown', 20, 60 * 60);
    const parsed = parseToken(token);
    if (!parsed) throw this.invalidToken();
    const done = await this.tenantTx.runAs({ tenantId: parsed.tenantId }, async (tx) => {
      const userId = await this.authTokens.claim(tx, parsed.secret, 'EMAIL_VERIFICATION');
      if (!userId) return false;
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: this.clock.now() },
      });
      await this.audit.write(
        tx,
        { action: 'auth.email_verified', actorUserId: userId, entity: 'user', entityId: userId },
        info,
      );
      return true;
    });
    if (!done) throw this.invalidToken();
  }

  /** Send a new verification link. Answers identically for every email; limited to protect inboxes from spam. */
  async resendVerification(email: string, info: RequestInfo): Promise<{ message: string }> {
    await this.limiter.hit('resend:ip', info.ip ?? 'unknown', 10, 60 * 60);
    await this.limiter.hit('resend:email', email, 3, 60 * 60);
    const record = await this.lookup.findByEmail(email);
    if (record && record.status === 'ACTIVE' && !record.emailVerifiedAt) {
      const token = await this.tenantTx.runAs(
        { tenantId: record.tenantId, userId: record.userId },
        (tx) =>
          this.authTokens.issue(
            tx,
            record.tenantId,
            record.userId,
            'EMAIL_VERIFICATION',
            VERIFICATION_TOKEN_HOURS * 60,
          ),
      );
      await this.send(
        verificationEmail({
          to: record.email,
          brand: this.brand,
          name: record.fullName,
          link: `${this.webBaseUrl}/verify-email?token=${encodeURIComponent(token)}`,
          validHours: VERIFICATION_TOKEN_HOURS,
        }),
        'verification',
      );
    }
    return { message: NEUTRAL_MESSAGE };
  }

  // ---------------------------------------------------------------------------------------------
  // Sign in, renew, sign out
  // ---------------------------------------------------------------------------------------------

  /**
   * Sign in with email and password (and a code if the account uses an authenticator app).
   *
   * @throws INVALID_CREDENTIALS  wrong email or password (the same answer for both, and for disabled accounts)
   * @throws RATE_LIMITED         too many tries from this address, or the account is temporarily locked
   * @throws EMAIL_NOT_VERIFIED   right password, but the email address was never confirmed
   * @throws TOTP_REQUIRED        right password, a code is needed: send the request again with `totpCode`
   * @throws INVALID_TOTP_CODE    the code was wrong or already used
   */
  async login(dto: LoginDto, info: RequestInfo): Promise<SignInResult> {
    await this.limiter.hit('login:ip', info.ip ?? 'unknown', 30, 60);
    await this.limiter.assertNotLocked(dto.email);

    const record = await this.lookup.findByEmail(dto.email);
    if (!record || !record.passwordHash || record.status !== 'ACTIVE') {
      // Spend the same time as a real check, so "no such account" cannot be told from "wrong password" by speed.
      await this.hasher.burnTime(dto.password);
      await this.limiter.recordLoginFailure(dto.email);
      this.logger.warn({
        msg: 'Sign-in failed',
        event: 'login.failed',
        reason: 'unknown_or_inactive',
      });
      throw this.invalidCredentials();
    }

    const check = await this.hasher.verify(record.passwordHash, dto.password);
    if (!check.valid) {
      await this.limiter.recordLoginFailure(dto.email);
      await this.recordFailureAudit(record.tenantId, record.userId, 'wrong_password', info);
      // A business event for the logs (observability.md section 2). No email or password is written.
      this.logger.warn({
        msg: 'Sign-in failed',
        event: 'login.failed',
        reason: 'wrong_password',
        tenantId: record.tenantId,
      });
      throw this.invalidCredentials();
    }
    if (!record.emailVerifiedAt)
      throw new DomainError(
        'EMAIL_NOT_VERIFIED',
        'Please confirm your email address first. Check your inbox for the link.',
      );

    const outcome = await this.tenantTx.runAs(
      { tenantId: record.tenantId, userId: record.userId },
      async (tx) => {
        if (record.totpEnabled) {
          const factor = await this.twoFactor.checkFactor(tx, record.userId, dto);
          if (factor === 'missing') return { kind: 'totp_required' as const };
          if (factor === 'invalid') {
            await this.audit.write(
              tx,
              {
                action: 'auth.login_failed',
                actorUserId: record.userId,
                metadata: { reason: 'wrong_totp' },
              },
              info,
            );
            return { kind: 'totp_invalid' as const };
          }
        }
        // Success. If the stored hash uses an old pepper or weaker settings, replace it now (we have the password).
        const upgrade = check.needsRehash
          ? { passwordHash: await this.hasher.hash(dto.password) }
          : {};
        await tx.user.update({
          where: { id: record.userId },
          data: { lastLoginAt: this.clock.now(), ...upgrade },
        });
        const session = await this.sessions.createInTx(tx, {
          tenantId: record.tenantId,
          userId: record.userId,
          clientType: dto.clientType,
          info,
        });
        await this.audit.write(
          tx,
          {
            action: 'auth.login',
            actorUserId: record.userId,
            entity: 'session',
            entityId: session.sessionId,
          },
          info,
        );
        return { kind: 'ok' as const, ...session };
      },
    );

    if (outcome.kind === 'totp_required')
      throw new DomainError('TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app.');
    if (outcome.kind === 'totp_invalid') {
      await this.limiter.recordLoginFailure(dto.email);
      this.logger.warn({
        msg: 'Sign-in failed',
        event: 'login.failed',
        reason: 'wrong_totp',
        tenantId: record.tenantId,
      });
      throw new DomainError('INVALID_TOTP_CODE', 'That code is not right or was already used.');
    }

    await this.limiter.clearLoginFailures(dto.email);
    const access = await this.tokens.sign({
      userId: record.userId,
      tenantId: record.tenantId,
      sessionId: outcome.sessionId,
    });
    const {
      user,
      tenant,
      access: permissions,
    } = await this.profile(record.tenantId, record.userId);
    return {
      refreshToken: outcome.refreshToken,
      sessionId: outcome.sessionId,
      body: {
        accessToken: access.token,
        tokenType: 'Bearer',
        expiresInSeconds: access.expiresInSeconds,
        user,
        tenant,
        access: permissions,
      },
    };
  }

  /**
   * Exchange a refresh token for a new access token (and the next refresh token).
   * @throws INVALID_REFRESH_TOKEN when the session can no longer be renewed: send the person to the login screen.
   */
  async refresh(
    refreshToken: string,
    info: RequestInfo,
  ): Promise<{ body: RefreshResponseDto; newRefreshToken?: string }> {
    await this.limiter.hit('refresh:ip', info.ip ?? 'unknown', 120, 60);
    const result = await this.sessions.rotate(refreshToken, info);
    const access = await this.tokens.sign({
      userId: result.userId,
      tenantId: result.tenantId,
      sessionId: result.sessionId,
    });
    return {
      body: {
        accessToken: access.token,
        tokenType: 'Bearer',
        expiresInSeconds: access.expiresInSeconds,
      },
      newRefreshToken: result.kind === 'rotated' ? result.refreshToken : undefined,
    };
  }

  /** Sign out: end the session the refresh token belongs to. Never fails, so a stale tab can always "log out". */
  async logout(refreshToken: string | undefined, info: RequestInfo): Promise<void> {
    if (refreshToken) await this.sessions.revokeByRefreshToken(refreshToken, info);
  }

  /** The signed-in person and their business. */
  async me(auth: AuthenticatedUser): Promise<MeResponseDto> {
    return this.profile(auth.tenantId, auth.userId);
  }

  // ---------------------------------------------------------------------------------------------
  // Passwords
  // ---------------------------------------------------------------------------------------------

  /** Email a reset link. Answers identically for every email. */
  async forgotPassword(email: string, info: RequestInfo): Promise<{ message: string }> {
    await this.limiter.hit('forgot:ip', info.ip ?? 'unknown', 10, 60 * 60);
    await this.limiter.hit('forgot:email', email, 3, 60 * 60);
    const record = await this.lookup.findByEmail(email);
    if (record && record.status === 'ACTIVE') {
      const token = await this.tenantTx.runAs(
        { tenantId: record.tenantId, userId: record.userId },
        async (tx) => {
          const issued = await this.authTokens.issue(
            tx,
            record.tenantId,
            record.userId,
            'PASSWORD_RESET',
            RESET_TOKEN_MINUTES,
          );
          await this.audit.write(
            tx,
            {
              action: 'auth.password_reset_requested',
              actorUserId: record.userId,
              entity: 'user',
              entityId: record.userId,
            },
            info,
          );
          return issued;
        },
      );
      await this.send(
        passwordResetEmail({
          to: record.email,
          brand: this.brand,
          name: record.fullName,
          link: `${this.webBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
          validMinutes: RESET_TOKEN_MINUTES,
        }),
        'password-reset',
      );
    }
    return { message: NEUTRAL_MESSAGE };
  }

  /**
   * Choose a new password with the emailed token. The token works once. All sessions end, which signs the
   * person (and anyone who had stolen the old password) out everywhere. Opening the link also proves the
   * person owns the address, so the email counts as verified.
   */
  async resetPassword(dto: ResetPasswordDto, info: RequestInfo): Promise<void> {
    await this.limiter.hit('reset:ip', info.ip ?? 'unknown', 10, 60 * 60);
    const parsed = parseToken(dto.token);
    if (!parsed) throw this.invalidToken();

    // Look at the token first (without using it) so a weak password can be corrected without wasting the link.
    const who = await this.tenantTx.runAs({ tenantId: parsed.tenantId }, async (tx) => {
      const row = await tx.authToken.findUnique({
        where: { tokenHash: hashSecret(parsed.secret) },
        include: { user: true },
      });
      const valid =
        row && row.purpose === 'PASSWORD_RESET' && !row.usedAt && row.expiresAt > this.clock.now();
      return valid ? row.user : null;
    });
    if (!who) throw this.invalidToken();
    await this.rules.assertAcceptable(dto.newPassword, {
      email: who.email,
      fullName: who.fullName,
    });
    const passwordHash = await this.hasher.hash(dto.newPassword);

    const ended = await this.tenantTx.runAs(
      { tenantId: parsed.tenantId, userId: who.id },
      async (tx) => {
        const userId = await this.authTokens.claim(tx, parsed.secret, 'PASSWORD_RESET');
        if (!userId) return null;
        const now = this.clock.now();
        await tx.user.update({
          where: { id: userId },
          data: {
            passwordHash,
            passwordChangedAt: now,
            ...(who.emailVerifiedAt ? {} : { emailVerifiedAt: now }),
          },
        });
        const sessionIds = await this.sessions.revokeAllInTx(tx, userId, 'PASSWORD_RESET');
        await this.audit.write(
          tx,
          {
            action: 'auth.password_reset',
            actorUserId: userId,
            entity: 'user',
            entityId: userId,
            metadata: { sessionsEnded: sessionIds.length },
          },
          info,
        );
        return sessionIds;
      },
    );
    if (!ended) throw this.invalidToken();

    await this.sessions.afterRevoked(ended);
    await this.limiter.clearLoginFailures(who.email);
    await this.send(
      passwordChangedEmail({ to: who.email, brand: this.brand, name: who.fullName }),
      'password-changed',
    );
  }

  /** Change the password while signed in. Needs the current password. Other devices are signed out. */
  async changePassword(
    auth: AuthenticatedUser,
    dto: ChangePasswordDto,
    info: RequestInfo,
  ): Promise<void> {
    await this.limiter.hit('chpw:user', auth.userId, 5, 15 * 60);
    const user = await this.tenantTx.run((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: auth.userId } }),
    );
    const current = user.passwordHash
      ? await this.hasher.verify(user.passwordHash, dto.currentPassword)
      : { valid: false };
    if (!current.valid)
      throw new DomainError('INVALID_CREDENTIALS', 'The current password is not correct.');
    await this.rules.assertAcceptable(dto.newPassword, {
      email: user.email,
      fullName: user.fullName,
    });
    const passwordHash = await this.hasher.hash(dto.newPassword);

    const ended = await this.tenantTx.run(async (tx) => {
      await tx.user.update({
        where: { id: auth.userId },
        data: { passwordHash, passwordChangedAt: this.clock.now() },
      });
      const sessionIds = await this.sessions.revokeAllInTx(
        tx,
        auth.userId,
        'PASSWORD_CHANGED',
        auth.sessionId,
      );
      await this.audit.write(
        tx,
        {
          action: 'auth.password_changed',
          actorUserId: auth.userId,
          entity: 'user',
          entityId: auth.userId,
          metadata: { sessionsEnded: sessionIds.length },
        },
        info,
      );
      return sessionIds;
    });
    await this.sessions.afterRevoked(ended);
    await this.send(
      passwordChangedEmail({ to: user.email, brand: this.brand, name: user.fullName }),
      'password-changed',
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  /** The user and business as the API describes them. */
  private async profile(
    tenantId: string,
    userId: string,
  ): Promise<{ user: AuthUserDto; tenant: AuthTenantDto; access: AccessSummaryDto }> {
    return this.tenantTx.runAs({ tenantId, userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const access = await this.accessService.loadIn(tx, userId);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      return {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          isOwner: user.isOwner,
          totpEnabled: user.totpEnabledAt !== null,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
        },
        access: {
          roleName: access.roleName,
          permissions: [...access.permissions],
          discountLimitBp: access.discountLimitBp,
          allBranches: access.branchScope === 'ALL',
          branchIds: access.branchScope === 'ALL' ? [] : [...access.branchScope],
        },
      };
    });
  }

  /** Audit a wrong password for a KNOWN account (unknown emails have no business to attach a row to). */
  private async recordFailureAudit(
    tenantId: string,
    userId: string,
    reason: string,
    info: RequestInfo,
  ): Promise<void> {
    await this.tenantTx.runAs({ tenantId, userId }, (tx) =>
      this.audit.write(
        tx,
        { action: 'auth.login_failed', actorUserId: userId, metadata: { reason } },
        info,
      ),
    );
  }

  private async sendAlreadyRegistered(email: string, name: string): Promise<void> {
    await this.send(
      alreadyRegisteredEmail({
        to: email,
        brand: this.brand,
        name,
        loginLink: `${this.webBaseUrl}/login`,
        resetLink: `${this.webBaseUrl}/forgot-password`,
      }),
      'already-registered',
    );
  }

  /**
   * Send an email without letting a mail-server problem break the request: the visible answer must stay the same
   * whether or not an email was sent (otherwise the failure would itself leak information). The failure is logged
   * (never with the address) and the person can use "resend".
   */
  private async send(message: MailMessage, template: string): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (error) {
      this.logger.error({ msg: 'Could not send email', template, err: error });
    }
  }

  private invalidCredentials(): DomainError {
    return new DomainError('INVALID_CREDENTIALS', 'The email or password is not correct.');
  }

  private invalidToken(): DomainError {
    return new DomainError('INVALID_TOKEN', 'This link is not valid any more. Request a new one.');
  }
}
