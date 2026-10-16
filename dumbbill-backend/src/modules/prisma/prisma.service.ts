import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

/**
 * The shared database client. It connects with APP_DATABASE_URL, the restricted `dumbbill_app` role
 * that can never bypass row-level security (see docs/adr/002-prisma-rls.md).
 *
 * IMPORTANT, read before using:
 * Business code must NOT inject this class. A query run directly on this client has no tenant set,
 * so the database would hide every tenant row (and, if someone worked around that, it would be a
 * data-leak risk). Business code uses `TenantTx` instead, which opens a transaction that is already
 * locked to one business. An ESLint rule blocks importing this file outside the few places that
 * legitimately need it (the readiness probe, the tenancy module, and this module).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    // `datasourceUrl` overrides the DATABASE_URL (owner) written in schema.prisma, so the running
    // API can never accidentally connect as the powerful owner role.
    super({ datasourceUrl: config.getOrThrow<string>('APP_DATABASE_URL') });
  }

  /** Close database connections when the app shuts down. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
