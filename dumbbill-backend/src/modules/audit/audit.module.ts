import { Global, Module } from '@nestjs/common';
import { AuditChainService } from './audit-chain.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * The audit log: the writer every feature uses (`AuditService`, global), the tamper-evident chain over it
 * (`AuditChainService`) and the viewer for people with `audit.read`.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditChainService],
  exports: [AuditService, AuditChainService],
})
export class AuditModule {}
