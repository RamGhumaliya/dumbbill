import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';

/**
 * The business profile and its branches (P1-3): GSTIN and state, addresses, invoice prefixes, receipt width,
 * the plan's branch limit, and the first-steps checklist. Uses the global Tenancy, Audit and Permissions modules.
 */
@Module({
  controllers: [BusinessController, BranchesController],
  providers: [BusinessService, BranchesService],
})
export class BusinessModule {}
