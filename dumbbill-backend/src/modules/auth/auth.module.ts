import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { Clock, SystemClock } from '../../common/clock';
import { AuthController } from './auth.controller';
import { AuthTokenService } from './auth-token.service';
import { AuthService } from './auth.service';
import { SecretCipher } from './crypto/secret-cipher.service';
import { AuthContextMiddleware } from './http/auth-context.middleware';
import { AuthGuard } from './http/auth.guard';
import { BreachChecker, HibpBreachChecker, NoBreachChecker } from './password/breach-checker';
import { PasswordHasher } from './password/password-hasher.service';
import { PasswordRules } from './password/password-rules.service';
import { RATE_LIMIT_DISABLED, RateLimiter } from './rate-limit/rate-limiter.service';
import { RevocationList } from './session/revocation-list';
import { SessionService } from './session/session.service';
import { EphemeralStore, RedisEphemeralStore } from './store/ephemeral-store';
import { AccessTokenService } from './tokens/access-token.service';
import { TwoFactorService } from './two-factor.service';

/**
 * Sign-up, sign-in, sessions and two-step login (P1-1).
 *
 * Wiring notes:
 *  - `AuthGuard` is registered as a GLOBAL guard (APP_GUARD): every route in the whole API needs a valid token
 *    unless it is marked `@Public()`. New modules get this protection without doing anything.
 *  - `AuthContextMiddleware` is applied to all routes below; it verifies the token and sets the tenant context
 *    for the rest of the request.
 *  - Tests replace `EphemeralStore`, `Mailer`, `BreachChecker` and `Clock` with in-memory versions.
 */
@Module({
  controllers: [AuthController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      // Redis holds the short-lived facts (rate limits, lockouts, ended sessions).
      provide: EphemeralStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EphemeralStore =>
        new RedisEphemeralStore(config.getOrThrow<string>('REDIS_URL')),
    },
    {
      provide: BreachChecker,
      inject: [ConfigService, Logger],
      useFactory: (config: ConfigService, logger: Logger): BreachChecker =>
        config.getOrThrow<boolean>('PASSWORD_BREACH_CHECK')
          ? new HibpBreachChecker(logger)
          : new NoBreachChecker(),
    },
    {
      provide: RATE_LIMIT_DISABLED,
      inject: [ConfigService],
      useFactory: (config: ConfigService): boolean =>
        config.get<boolean>('RATE_LIMIT_DISABLED') === true,
    },
    PasswordHasher,
    PasswordRules,
    AuthTokenService,
    SecretCipher,
    AccessTokenService,
    RateLimiter,
    RevocationList,
    SessionService,
    TwoFactorService,
    AuthService,
    AuthContextMiddleware,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  // Shared with the team module (invitations, PIN, disabling people ends their sessions).
  exports: [Clock, PasswordHasher, PasswordRules, AuthTokenService, RateLimiter, SessionService],
})
export class AuthModule implements NestModule {
  /**
   * Read the access token on every request. This runs next to (not after) the request-id middleware: the two
   * keep separate per-request stores, so their order does not matter.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
