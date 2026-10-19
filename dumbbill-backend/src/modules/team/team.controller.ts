import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { ClientInfo } from '../auth/http/decorators';
import { LoadedAccess } from '../permissions/access.service';
import { Permission } from '../permissions/permission.decorators';
import {
  CreateRoleDto,
  InviteMemberDto,
  UpdateMemberDto,
  UpdateRoleDto,
  VerifyPinDto,
} from './dto/team-requests.dto';
import {
  ApproverListDto,
  MemberDto,
  MemberListDto,
  PinApprovedDto,
  RoleDto,
  RoleListDto,
  TeamOptionsDto,
} from './dto/team-responses.dto';
import { MembersService } from './members.service';
import { PinService } from './pin.service';
import { RolesService } from './roles.service';

/** The signed-in person's access, loaded by the permissions guard before any of these methods run. */
function accessOf(request: Request): LoadedAccess {
  if (!request.access) throw new Error('Permissions guard did not run for a team route.');
  return request.access;
}

/**
 * Team and permissions: who works for the business, what each person may do, and the approval PIN.
 *
 * Managing the team needs `team.manage` (the owner always has it; others only if the owner gave it to them). Nobody can
 * hand out more than they hold, change their own access, or touch the owner: see MembersService and RolesService.
 */
@ApiTags('Team & Permissions')
@ApiBearerAuth('staff-bearer')
@Controller('v1/team')
export class TeamController {
  constructor(
    private readonly members: MembersService,
    private readonly roles: RolesService,
    private readonly pins: PinService,
  ) {}

  // --- Reference data for the screens -----------------------------------------------------------

  @Get('options')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'getTeamOptions',
    summary: 'Roles, branches and permissions for the team screen',
    description:
      'Everything the team screen needs to draw its forms in one call: the roles, the active branches, the catalogue of permissions (with plain-English labels), and how many seats the plan allows.\n\nPermission: team.manage',
  })
  @ApiOkResponse({ type: TeamOptionsDto, description: 'Options for the team forms.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have permission to do this.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  getTeamOptions(): Promise<TeamOptionsDto> {
    return this.members.options();
  }

  // --- Roles ---------------------------------------------------------------------------------------

  @Get('roles')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'listRoles',
    summary: 'List roles',
    description:
      'All roles of the business with their permissions and how many people hold each.\n\nPermission: team.manage',
  })
  @ApiOkResponse({ type: RoleListDto, description: 'The roles.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async listRoles(): Promise<RoleListDto> {
    return { roles: await this.roles.list() };
  }

  @Post('roles')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'createRole',
    summary: 'Create a role',
    description:
      'Makes a new role. You can only include permissions you hold yourself, a discount limit no bigger than your own, and "all branches" only if you have it.\n\nPermission: team.manage',
  })
  @ApiCreatedResponse({ type: RoleDto, description: 'The new role.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'permissions', message: 'each item must be a known permission' }],
  })
  @ApiProblemResponse('CONFLICT', { detail: 'A role with this name already exists.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    detail: 'You can only grant permissions you hold yourself. Missing: invoice.refund.',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  createRole(
    @Req() request: Request,
    @Body() dto: CreateRoleDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<RoleDto> {
    return this.roles.create(accessOf(request), dto, info);
  }

  @Patch('roles/:roleId')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'updateRole',
    summary: 'Change a role',
    description:
      "Changes a role's permissions, discount limit, branch rule or description. Applies to everyone in the role from their very next request. The Owner role is locked; the built-in Admin and Cashier roles keep their names. Adding power needs you to hold that power; taking it away is always allowed.\n\nPermission: team.manage",
  })
  @ApiOkResponse({ type: RoleDto, description: 'The updated role.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [
      { field: 'discountLimitBp', message: 'discountLimitBp must not be greater than 10000' },
    ],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No role with this id.' })
  @ApiProblemResponse('CONFLICT', { detail: 'A role with this name already exists.' })
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', { detail: 'The built-in roles keep their names.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    detail: 'The Owner role always has every permission and cannot be changed.',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  updateRole(
    @Req() request: Request,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @Body() dto: UpdateRoleDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<RoleDto> {
    return this.roles.update(accessOf(request), roleId, dto, info);
  }

  @Delete('roles/:roleId')
  @HttpCode(204)
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'deleteRole',
    summary: 'Delete a role',
    description:
      'Deletes a role the business made itself, when nobody has it. The built-in roles cannot be deleted.\n\nPermission: team.manage',
  })
  @ApiNoContentResponse({ description: 'The role was deleted.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No role with this id.' })
  @ApiProblemResponse('CONFLICT', {
    detail: '2 people still have this role. Move them to another role first.',
  })
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', {
    detail: 'The built-in roles cannot be deleted.',
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async deleteRole(
    @Req() request: Request,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.roles.remove(accessOf(request), roleId, info);
  }

  // --- Members -------------------------------------------------------------------------------------

  @Get('members')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'listMembers',
    summary: 'List team members',
    description:
      'Everyone in the business with their role, what they can actually do, and whether they have accepted their invitation.\n\nPermission: team.manage',
  })
  @ApiOkResponse({ type: MemberListDto, description: 'The team.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async listMembers(): Promise<MemberListDto> {
    return { members: await this.members.list() };
  }

  @Get('members/:memberId')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'getMember',
    summary: 'Get one team member',
    description:
      'One person of the business. A person of another business gives 404.\n\nPermission: team.manage',
  })
  @ApiOkResponse({ type: MemberDto, description: 'The team member.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No team member with this id.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getMember(@Param('memberId', new ParseUUIDPipe()) memberId: string): Promise<MemberDto> {
    return this.members.get(memberId);
  }

  @Post('members')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'inviteMember',
    summary: 'Invite a team member',
    description:
      "Adds a person and emails them a link (valid 7 days) to choose their own password. Counts against the plan's user limit. You can only grant permissions, a discount limit and branch access you hold yourself. An address that already has an account anywhere cannot be invited (the answer never says whose it is). Limited to 20 invitations an hour.\n\nPermission: team.manage",
  })
  @ApiCreatedResponse({ type: MemberDto, description: 'The invited person (status INVITED).' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'email', message: 'email must be an email' }],
  })
  @ApiProblemResponse('CONFLICT', { detail: 'This email address cannot be invited.' })
  @ApiProblemResponse('PLAN_LIMIT_REACHED', {
    detail: 'Your plan allows 3 people and all seats are used.',
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('NOT_FOUND', { detail: 'No role with this id.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    detail: 'You can only grant permissions you hold yourself. Missing: reports.profit.',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  inviteMember(
    @Req() request: Request,
    @Body() dto: InviteMemberDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<MemberDto> {
    return this.members.invite(accessOf(request), dto, info);
  }

  @Patch('members/:memberId')
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'updateMember',
    summary: "Change a team member's access",
    description:
      "Changes role, extra or removed permissions, branches or discount limit. Applies from the person's very next request. You cannot change the owner or yourself, and you can only add power you hold yourself.\n\nPermission: team.manage",
  })
  @ApiOkResponse({ type: MemberDto, description: 'The updated team member.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'extraPermissions', message: 'each item must be a known permission' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No team member with this id.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    detail: 'You cannot change your own role or permissions, or switch yourself off.',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  updateMember(
    @Req() request: Request,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() dto: UpdateMemberDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<MemberDto> {
    return this.members.update(accessOf(request), memberId, dto, info);
  }

  @Post('members/:memberId/disable')
  @HttpCode(200)
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'disableMember',
    summary: 'Switch a team member off',
    description:
      "Removes the person's access at once: every session ends and their next request is refused. Their history stays. You cannot switch off the owner or yourself.\n\nPermission: team.manage",
  })
  @ApiOkResponse({ type: MemberDto, description: 'The person, now DISABLED.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No team member with this id.' })
  @ApiProblemResponse('CONFLICT', { detail: 'This person is already switched off.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: "The owner's access cannot be changed." })
  @ApiProblemResponse('INTERNAL_ERROR')
  disableMember(
    @Req() request: Request,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<MemberDto> {
    return this.members.disable(accessOf(request), memberId, info);
  }

  @Post('members/:memberId/enable')
  @HttpCode(200)
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'enableMember',
    summary: 'Switch a team member back on',
    description:
      'Restores access. Needs a free seat on the plan. Someone who never accepted their invitation returns to INVITED and needs a new link.\n\nPermission: team.manage',
  })
  @ApiOkResponse({ type: MemberDto, description: 'The person, now ACTIVE or INVITED.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No team member with this id.' })
  @ApiProblemResponse('CONFLICT', { detail: 'This person is not switched off.' })
  @ApiProblemResponse('PLAN_LIMIT_REACHED')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  enableMember(
    @Req() request: Request,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<MemberDto> {
    return this.members.enable(accessOf(request), memberId, info);
  }

  @Post('members/:memberId/resend-invitation')
  @HttpCode(204)
  @Permission('team.manage')
  @ApiOperation({
    operationId: 'resendInvitation',
    summary: 'Send an invitation again',
    description:
      'Sends a new invitation link to someone who has not accepted yet. Older links stop working. Limited to 5 an hour per person.\n\nPermission: team.manage',
  })
  @ApiNoContentResponse({ description: 'A new invitation was sent.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No team member with this id.' })
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', {
    detail: 'This person has already accepted their invitation.',
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async resendInvitation(
    @Req() request: Request,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.members.resendInvitation(accessOf(request), memberId, info);
  }

  // --- Discount approval by PIN ------------------------------------------------------------------------

  @Get('approvers')
  @Permission('pos.sell')
  @ApiOperation({
    operationId: 'listApprovers',
    summary: 'List people who can approve a discount',
    description:
      'Active people who may approve discounts and have set a PIN: the cashier picks one, and the approver types their PIN.\n\nPermission: pos.sell',
  })
  @ApiOkResponse({ type: ApproverListDto, description: 'The approvers.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async listApprovers(): Promise<ApproverListDto> {
    return { approvers: await this.pins.listApprovers() };
  }

  @Post('approvals/verify-pin')
  @HttpCode(200)
  @Permission('pos.sell')
  @ApiOperation({
    operationId: 'verifyApproverPin',
    summary: "Check an approver's PIN",
    description:
      'Checks the PIN of a person who may approve discounts. The answer is the same `INVALID_PIN` whether the PIN is wrong, the person has none, is switched off or may not approve. After 5 wrong tries the PIN is locked for the person trying (1 minute, doubling). Each check is audited.\n\nPermission: pos.sell',
  })
  @ApiOkResponse({
    type: PinApprovedDto,
    description: 'The PIN is right and the person may approve.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'pin', message: 'must be exactly 6 digits' }],
  })
  @ApiProblemResponse('INVALID_PIN')
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async verifyApproverPin(
    @Req() request: Request,
    @Body() dto: VerifyPinDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<PinApprovedDto> {
    return {
      approver: await this.pins.verifyApproverPin(
        accessOf(request),
        dto.approverUserId,
        dto.pin,
        info,
      ),
    };
  }
}
