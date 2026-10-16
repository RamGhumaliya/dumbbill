import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from './common/logging/logger.config';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
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
        buildLoggerParams(
          config.getOrThrow<string>('LOG_LEVEL'),
          config.getOrThrow<string>('NODE_ENV') === 'production',
        ),
    }),

    PrismaModule, // low-level database client (restricted app role)
    TenancyModule, // TenantTx: tenant-locked transactions, the way business code reads/writes data
    StorageModule, // uploaded files (server disk today)
    HealthModule, // /healthz and /readyz
  ],
})
export class AppModule {}
