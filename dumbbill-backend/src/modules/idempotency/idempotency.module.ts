import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/** Makes `IdempotencyService` available to every feature module (purchases, stock changes, and later invoices). */
@Global()
@Module({ providers: [IdempotencyService], exports: [IdempotencyService] })
export class IdempotencyModule {}
