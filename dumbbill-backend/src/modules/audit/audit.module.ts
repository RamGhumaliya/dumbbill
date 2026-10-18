import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Makes `AuditService` available to every feature module. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
