import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from './common/logging/logger.config';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { validateEnv } from './config/env.validation';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { TeamModule } from './modules/team/team.module';
import { StorageModule } from './modules/storage/storage.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

/**
 * Root of the application. Every feature module is listed here.
 * New business modules (auth, products, pos, ...) are added to `imports` as they are built.
 */
@Module({
  imports: [
    // Reads .env, validates it (the app stops here if a setting is wrong) and makes it
    // available everywhere through ConfigService.
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => ({ ...validateEnv(raw) }) }),

    // Structured JSON logging. Built after config so it can use LOG_LEVEL.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildLoggerParams({
          level: config.getOrThrow<string>('LOG_LEVEL'),
          isProduction: config.getOrThrow<string>('NODE_ENV') === 'production',
          environment: config.getOrThrow<string>('NODE_ENV'),
          version: config.getOrThrow<string>('APP_VERSION'),
        }),
    }),

    PrismaModule, // low-level database client (restricted app role)
    TenancyModule, // TenantTx: tenant-locked transactions, the way business code reads/writes data
    StorageModule, // uploaded files (server disk today)
    MailModule, // outgoing email (Mailpit locally)
    AuditModule, // append-only audit log writer
    PermissionsModule, // who may do what: the global permission guard and branch scope
    AuthModule, // sign-up, sign-in, sessions, two-step login; also the global login guard
    TeamModule, // roles, members, invitations, approval PIN
    HealthModule, // /healthz and /readyz
  ],
})
export class AppModule implements NestModule {
  /** Give every request an id (and make it available everywhere) before anything else runs. */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
