import { Global, Module } from '@nestjs/common';
import { TenantTx } from './tenant-tx.service';

/**
 * Makes `TenantTx` available to every feature module.
 * Feature modules inject `TenantTx` (never `PrismaService`) to reach the database.
 */
@Global()
@Module({ providers: [TenantTx], exports: [TenantTx] })
export class TenancyModule {}
