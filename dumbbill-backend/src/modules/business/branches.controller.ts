import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { ClientInfo } from '../auth/http/decorators';
import { LoadedAccess } from '../permissions/access.service';
import { Authenticated, Permission } from '../permissions/permission.decorators';
import { BranchesService } from './branches.service';
import { BranchDetailsDto } from './dto/business-requests.dto';
import { BranchDto, BranchListDto } from './dto/business-responses.dto';

/** The signed-in person's access, loaded by the permissions guard before any of these methods run. */
function accessOf(request: Request): LoadedAccess {
  if (!request.access) throw new Error('Permissions guard did not run for a branch route.');
  return request.access;
}

const PLAN_LIMIT_DETAIL =
  'Your plan allows 1 branch and all are in use. Switch a branch off or upgrade the plan.';

/**
 * Branches. Anyone signed in may read the branches they are allowed to use (a cashier needs their own branch's name
 * and printer width); creating and changing branches needs `settings.manage`.
 */
@ApiTags('Branches')
@ApiBearerAuth('staff-bearer')
@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    operationId: 'listBranches',
    summary: 'List branches',
    description:
      'The branches the caller may use, active ones first, and how many active branches the plan allows. Owners and "all branches" roles see every branch; others only the branches assigned to them.\n\nPermission: any signed-in user (own account).',
  })
  @ApiOkResponse({ type: BranchListDto, description: 'The branches and the plan limit.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  listBranches(@Req() request: Request): Promise<BranchListDto> {
    return this.branches.list(accessOf(request));
  }

  @Post()
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'createBranch',
    summary: 'Add a branch',
    description:
      "Creates a branch with its own address, state, optional GSTIN, invoice prefix and receipt width. Counts against the plan's branch limit. A branch GSTIN must start with the branch's state code and share the business GSTIN's PAN.\n\nPermission: settings.manage",
  })
  @ApiCreatedResponse({ type: BranchDto, description: 'The new branch.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [
      { field: 'invoicePrefix', message: 'invoicePrefix must be 1 to 6 capital letters or digits' },
    ],
  })
  @ApiProblemResponse('CONFLICT', {
    detail: 'Another branch already uses this invoice prefix.',
    errors: [{ field: 'invoicePrefix', message: 'Another branch already uses this prefix.' }],
  })
  @ApiProblemResponse('PLAN_LIMIT_REACHED', { detail: PLAN_LIMIT_DETAIL })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  createBranch(
    @Req() request: Request,
    @Body() dto: BranchDetailsDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<BranchDto> {
    return this.branches.create(accessOf(request), dto, info);
  }

  @Get(':branchId')
  @Authenticated()
  @ApiOperation({
    operationId: 'getBranch',
    summary: 'Get a branch',
    description:
      'One branch. A branch of another business answers 404; a branch of this business that the caller may not use answers 403.\n\nPermission: any signed-in user (own account).',
  })
  @ApiOkResponse({ type: BranchDto, description: 'The branch.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  getBranch(
    @Req() request: Request,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<BranchDto> {
    return this.branches.get(accessOf(request), branchId);
  }

  @Put(':branchId')
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'updateBranch',
    summary: 'Change a branch',
    description:
      'Replaces the branch details. The invoice prefix can be changed until the branch has issued an invoice.\n\nPermission: settings.manage',
  })
  @ApiOkResponse({ type: BranchDto, description: 'The saved branch.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'gstin', message: 'A GSTIN has 15 characters, like 27AAPFU0939F1ZV.' }],
  })
  @ApiProblemResponse('CONFLICT', {
    detail: 'Another branch already has this name.',
    errors: [{ field: 'name', message: 'Another branch already has this name.' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  updateBranch(
    @Req() request: Request,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: BranchDetailsDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<BranchDto> {
    return this.branches.update(accessOf(request), branchId, dto, info);
  }

  @Post(':branchId/deactivate')
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'deactivateBranch',
    summary: 'Switch a branch off',
    description:
      'Stops the branch being used for new work. History is kept. The last active branch cannot be switched off.\n\nPermission: settings.manage',
  })
  @ApiOkResponse({ type: BranchDto, description: 'The branch, now switched off.' })
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', {
    detail: 'This is your only active branch. Add another branch before switching this one off.',
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  deactivateBranch(
    @Req() request: Request,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<BranchDto> {
    return this.branches.deactivate(accessOf(request), branchId, info);
  }

  @Post(':branchId/activate')
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'activateBranch',
    summary: 'Switch a branch back on',
    description:
      "Makes a switched-off branch usable again. Counts against the plan's branch limit.\n\nPermission: settings.manage",
  })
  @ApiOkResponse({ type: BranchDto, description: 'The branch, now active.' })
  @ApiProblemResponse('PLAN_LIMIT_REACHED', { detail: PLAN_LIMIT_DETAIL })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  activateBranch(
    @Req() request: Request,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<BranchDto> {
    return this.branches.activate(accessOf(request), branchId, info);
  }
}
