import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountTeamController } from './account-team.controller';
import { MembersService } from './members.service';
import { PinService } from './pin.service';
import { RolesService } from './roles.service';
import { TeamController } from './team.controller';

/**
 * The team (P1-2): roles, members, invitations, switching people off, and the approval PIN.
 * It reuses the sign-in building blocks exported by AuthModule (password rules, hashing, one-time tokens, rate limits,
 * sessions) instead of copying them, so a rule changed there changes here too.
 */
@Module({
  imports: [AuthModule],
  controllers: [TeamController, AccountTeamController],
  providers: [RolesService, MembersService, PinService],
})
export class TeamModule {}
