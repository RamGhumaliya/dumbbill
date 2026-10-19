import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessService } from './access.service';
import { BranchScopeGuard } from './branch-scope';
import { PermissionsGuard } from './permissions.guard';

/**
 * Who may do what (P1-2). Registers two GLOBAL guards, so every route in the whole API is covered:
 *  1. `PermissionsGuard`: every route must declare @Public, @Authenticated or @Permission, and the caller must meet it;
 *  2. `BranchScopeGuard`: routes marked @BranchScoped refuse branches the person may not use.
 * Guards run in the order registered here (permissions first, because the branch check needs the access it loads).
 */
@Global()
@Module({
  providers: [
    AccessService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: BranchScopeGuard },
  ],
  exports: [AccessService],
})
export class PermissionsModule {}
