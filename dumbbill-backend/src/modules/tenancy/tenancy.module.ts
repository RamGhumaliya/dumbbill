import { Global, Module } from '@nestjs/common';
import { LoginLookup } from './login-lookup.service';
import { TenantTx } from './tenant-tx.service';

/**
 * Makes `TenantTx` available to every feature module.
 * Feature modules inject `TenantTx` (never `PrismaService`) to reach the database.
 * `LoginLookup` is the one narrow exception that works before the business is known (sign-in by email).
 */
@Global()
@Module({ providers: [TenantTx, LoginLookup], exports: [TenantTx, LoginLookup] })
export class TenancyModule {}
