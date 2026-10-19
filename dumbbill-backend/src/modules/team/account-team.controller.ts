import { Body, Controller, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { ClientInfo, CurrentUser, Public } from '../auth/http/decorators';
import { Authenticated } from '../permissions/permission.decorators';
import { AcceptInvitationDto, ClearPinDto, SetPinDto } from './dto/team-requests.dto';
import { MembersService } from './members.service';
import { PinService } from './pin.service';

/**
 * Account-level endpoints that belong to the team feature but live under `/v1/auth`: accepting an invitation (public:
 * the emailed token is the credential) and the signed-in person's own approval PIN.
 */
@ApiTags('Auth')
@Controller('v1/auth')
export class AccountTeamController {
  constructor(
    private readonly members: MembersService,
    private readonly pins: PinService,
  ) {}

  @Public()
  @Post('accept-invitation')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'acceptInvitation',
    summary: 'Accept a team invitation',
    description:
      'The invited person opens the link from the invitation email and chooses a password. The link works once and for 7 days. Opening it also confirms the email address. A refused password does not use up the link. Limited to 10 attempts an hour per IP address.\n\nPermission: public (the emailed token is the credential).',
  })
  @ApiNoContentResponse({ description: 'The account is active. The person can sign in.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'token', message: 'token must be a string' }],
  })
  @ApiProblemResponse('WEAK_PASSWORD', {
    detail: 'Use at least 10 characters.',
    errors: [{ field: 'password', message: 'Use at least 10 characters.' }],
  })
  @ApiProblemResponse('INVALID_TOKEN')
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.members.acceptInvitation(dto.token, dto.password, info);
  }

  @Authenticated()
  @Put('pin')
  @HttpCode(204)
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'setApprovalPin',
    summary: 'Set or change my approval PIN',
    description:
      'A 6-digit PIN used to approve discounts at the till. Needs the account password. Obvious PINs (123456, 000000) are refused. The PIN is stored hashed and is never shown again. Limited to 5 attempts per 15 minutes.\n\nPermission: any signed-in user (own account).',
  })
  @ApiNoContentResponse({ description: 'The PIN is set.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'pin', message: 'Do not use a straight run such as 123456.' }],
  })
  @ApiProblemResponse('INVALID_CREDENTIALS', { detail: 'The password is not correct.' })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have permission to do this.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  async setApprovalPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPinDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.pins.setPin(user.userId, dto.currentPassword, dto.pin, info);
  }

  @Authenticated()
  @Post('pin/clear')
  @HttpCode(204)
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'clearApprovalPin',
    summary: 'Remove my approval PIN',
    description:
      'Removes the PIN, so this person can no longer approve discounts at the till. Needs the account password.\n\nPermission: any signed-in user (own account).',
  })
  @ApiNoContentResponse({ description: 'The PIN is removed.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'currentPassword', message: 'currentPassword must be a string' }],
  })
  @ApiProblemResponse('INVALID_CREDENTIALS', { detail: 'The password is not correct.' })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have permission to do this.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  async clearApprovalPin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClearPinDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.pins.clearPin(user.userId, dto.currentPassword, info);
  }
}
