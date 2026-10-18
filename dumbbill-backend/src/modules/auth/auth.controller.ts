import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { DomainError } from '../../common/errors/domain-error';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';
import {
  ChangePasswordDto,
  ClientKind,
  EmailOnlyDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
  TotpCodeDto,
  TotpDisableDto,
  VerifyEmailDto,
} from './dto/auth-requests.dto';
import {
  AcceptedDto,
  LoginResponseDto,
  MeResponseDto,
  RefreshResponseDto,
  SessionListDto,
  TotpEnabledDto,
  TotpSetupDto,
} from './dto/auth-responses.dto';
import { ClientInfo, CurrentUser, Public } from './http/decorators';
import {
  assertCsrf,
  clearRefreshCookies,
  CookieSettings,
  readRefreshCookie,
  setRefreshCookies,
} from './http/refresh-cookie';
import { SessionService } from './session/session.service';
import { TwoFactorService } from './two-factor.service';

/**
 * Sign-up, sign-in and account security.
 *
 * HTTP only: the controller reads the request, calls `AuthService`, and decides how the answer travels
 * (JSON body versus cookie). The rules live in the services.
 *
 * Browser apps: the refresh token is an httpOnly cookie and `X-CSRF-Token` is required when it is used.
 * Mobile apps: the refresh token is in the JSON body. See the Auth section of the API description.
 */
@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  private readonly cookieSettings: CookieSettings;
  private readonly brand: string;

  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
  ) {
    this.cookieSettings = {
      secure: config.getOrThrow<string>('NODE_ENV') === 'production',
      domain: config.get<string>('COOKIE_DOMAIN') || undefined,
    };
    this.brand = config.getOrThrow<string>('BRAND_NAME');
  }

  // --- Sign-up and email verification ---------------------------------------------------------

  @Public()
  @Post('signup')
  @HttpCode(202)
  @ApiOperation({
    operationId: 'signUp',
    summary: 'Create a business and its owner',
    description:
      'Creates a new business (14-day trial) and its owner account, then emails a verification link (valid 24 hours). The account cannot sign in until the email is verified.\n\nThe answer is the **same whether or not the email already has an account** (an existing owner receives an "you already have an account" email instead), so this endpoint cannot be used to find out who uses the product.\n\nRate limit: 5 per hour per IP address.\n\nPermission: public.',
  })
  @ApiAcceptedResponse({
    type: AcceptedDto,
    description: 'Accepted. A message is on its way if the email can be used.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'email', message: 'email must be an email' }],
  })
  @ApiProblemResponse('WEAK_PASSWORD', {
    detail: 'Use at least 10 characters.',
    errors: [{ field: 'password', message: 'Use at least 10 characters.' }],
  })
  @ApiProblemResponse('RATE_LIMITED', {
    detail: 'Too many attempts. Please wait 3600 seconds and try again.',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  signUp(@Body() dto: SignupDto, @ClientInfo() info: RequestInfo): Promise<AcceptedDto> {
    return this.auth.signup(dto, info);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'verifyEmail',
    summary: 'Confirm an email address',
    description:
      'Uses the token from the link in the verification email. A token works once and expires after 24 hours.\n\nPermission: public.',
  })
  @ApiNoContentResponse({
    description: 'The email address is now verified. The person can sign in.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'token', message: 'token must be a string' }],
  })
  @ApiProblemResponse('INVALID_TOKEN', {
    detail: 'This link is not valid any more. Request a new one.',
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async verifyEmail(@Body() dto: VerifyEmailDto, @ClientInfo() info: RequestInfo): Promise<void> {
    await this.auth.verifyEmail(dto.token, info);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(202)
  @ApiOperation({
    operationId: 'resendVerificationEmail',
    summary: 'Send the verification email again',
    description:
      'Sends a new verification link if the account exists and is not verified yet. Older links stop working. Always answers the same way. Limited to 3 per hour per email address.\n\nPermission: public.',
  })
  @ApiAcceptedResponse({
    type: AcceptedDto,
    description: 'Accepted. A message is on its way if the email can be used.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'email', message: 'email must be an email' }],
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  resendVerificationEmail(
    @Body() dto: EmailOnlyDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<AcceptedDto> {
    return this.auth.resendVerification(dto.email, info);
  }

  // --- Sign-in, renew, sign-out -----------------------------------------------------------------

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'logIn',
    summary: 'Sign in with email and password',
    description:
      'Returns a 15-minute access token. Browser apps (`clientType: WEB`) also get the refresh token as an httpOnly cookie plus a readable `dumbbill_csrf` cookie; mobile apps (`MOBILE`) get the refresh token in the body.\n\n**Two-step login:** if the account uses an authenticator app and no code was sent, the answer is `401 TOTP_REQUIRED` (the password was right). Show a code box and repeat the request with `totpCode` (or `recoveryCode`).\n\nWrong email and wrong password give the **same** error and take about the same time. After 5 wrong attempts the account is locked for 1 minute, doubling per further failure up to 15 minutes (`429` with `Retry-After`). Limit: 30 attempts per minute per IP address.\n\nPermission: public.',
  })
  @ApiOkResponse({ type: LoginResponseDto, description: 'Signed in.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'clientType', message: 'clientType must be one of WEB, MOBILE' }],
  })
  @ApiProblemResponse('INVALID_CREDENTIALS', { detail: 'The email or password is not correct.' })
  @ApiProblemResponse('EMAIL_NOT_VERIFIED')
  @ApiProblemResponse('TOTP_REQUIRED')
  @ApiProblemResponse('INVALID_TOTP_CODE')
  @ApiProblemResponse('RATE_LIMITED', {
    detail: 'Too many attempts. Please wait 60 seconds and try again.',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  async logIn(
    @Body() dto: LoginDto,
    @ClientInfo() info: RequestInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(dto, info);
    if (dto.clientType === ClientKind.WEB) {
      // Browser: the refresh token goes into a cookie scripts cannot read, never into JSON.
      setRefreshCookies(res, result.refreshToken, this.cookieSettings);
      return result.body;
    }
    return { ...result.body, refreshToken: result.refreshToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'refreshAccessToken',
    summary: 'Get a new access token',
    description:
      'Exchanges the refresh token for a new access token **and a new refresh token**. Each refresh token works once. Presenting an already-used one (a sign of theft) ends the whole session.\n\nBrowser apps send no body: the cookie is used and the `X-CSRF-Token` header (the value of the `dumbbill_csrf` cookie) is required. Mobile apps send `refreshToken` in the body.\n\nIf two tabs refresh at the same instant, the second gets an access token but no new refresh token (the first response already delivered it).\n\nPermission: public (the refresh token is the credential).',
  })
  @ApiOkResponse({ type: RefreshResponseDto, description: 'A new access token.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'refreshToken', message: 'refreshToken must be a string' }],
  })
  @ApiProblemResponse('INVALID_REFRESH_TOKEN', { detail: 'Please sign in again.' })
  @ApiProblemResponse('CSRF_FAILED')
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async refreshAccessToken(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @ClientInfo() info: RequestInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponseDto> {
    const { token, viaCookie } = this.resolveRefreshToken(req, dto.refreshToken);
    try {
      const result = await this.auth.refresh(token, info);
      if (!viaCookie) return { ...result.body, refreshToken: result.newRefreshToken };
      if (result.newRefreshToken)
        setRefreshCookies(res, result.newRefreshToken, this.cookieSettings);
      return result.body;
    } catch (error) {
      // A dead session: remove the stale cookies so the browser stops sending them.
      if (viaCookie && error instanceof DomainError && error.code === 'INVALID_REFRESH_TOKEN') {
        clearRefreshCookies(res, this.cookieSettings);
      }
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'logOut',
    summary: 'Sign out this device',
    description:
      'Ends the session of the refresh token (cookie for browsers, `refreshToken` in the body for mobile). Access tokens of that session stop working at once. Always succeeds, even if the session was already over.\n\nPermission: public (the refresh token is the credential).',
  })
  @ApiNoContentResponse({ description: 'Signed out.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'refreshToken', message: 'refreshToken must be a string' }],
  })
  @ApiProblemResponse('CSRF_FAILED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async logOut(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @ClientInfo() info: RequestInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookieToken = readRefreshCookie(req);
    if (dto.refreshToken) {
      await this.auth.logout(dto.refreshToken, info);
    } else if (cookieToken) {
      assertCsrf(req);
      await this.auth.logout(cookieToken, info);
    }
    clearRefreshCookies(res, this.cookieSettings);
  }

  @Get('me')
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'getCurrentUser',
    summary: 'Who am I',
    description:
      'The signed-in person and their business.\n\nPermission: any signed-in user (own account).',
  })
  @ApiOkResponse({ type: MeResponseDto, description: 'The current user and business.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    description: 'Reserved: permission checks arrive with roles (P1-2).',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  getCurrentUser(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.auth.me(user);
  }

  // --- Passwords ---------------------------------------------------------------------------------

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({
    operationId: 'requestPasswordReset',
    summary: 'Email a password reset link',
    description:
      'Sends a single-use link valid for 30 minutes, if the account exists. Always answers the same way. Limited to 3 per hour per email address.\n\nPermission: public.',
  })
  @ApiAcceptedResponse({
    type: AcceptedDto,
    description: 'Accepted. A message is on its way if the email can be used.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'email', message: 'email must be an email' }],
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  requestPasswordReset(
    @Body() dto: EmailOnlyDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<AcceptedDto> {
    return this.auth.forgotPassword(dto.email, info);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'resetPassword',
    summary: 'Choose a new password from an emailed link',
    description:
      'Sets a new password using the token from the reset email (single use, 30 minutes). **Every session is ended**, and a notification email is sent.\n\nPermission: public (the emailed token is the credential).',
  })
  @ApiNoContentResponse({ description: 'The password was changed. Sign in with the new one.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'newPassword', message: 'newPassword must be a string' }],
  })
  @ApiProblemResponse('WEAK_PASSWORD', {
    detail: 'Use at least 10 characters.',
    errors: [{ field: 'password', message: 'Use at least 10 characters.' }],
  })
  @ApiProblemResponse('INVALID_TOKEN')
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.auth.resetPassword(dto, info);
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'changePassword',
    summary: 'Change my password',
    description:
      'Needs the current password. Ends the **other** sessions (this device stays signed in) and sends a notification email.\n\nPermission: any signed-in user (own account).',
  })
  @ApiNoContentResponse({ description: 'The password was changed.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'newPassword', message: 'newPassword must be a string' }],
  })
  @ApiProblemResponse('INVALID_CREDENTIALS', { detail: 'The current password is not correct.' })
  @ApiProblemResponse('WEAK_PASSWORD', {
    detail: 'Use at least 10 characters.',
    errors: [{ field: 'password', message: 'Use at least 10 characters.' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    description: 'Reserved: permission checks arrive with roles (P1-2).',
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.auth.changePassword(user, dto, info);
  }

  // --- Devices (sessions) -----------------------------------------------------------------------

  @Get('sessions')
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'listSessions',
    summary: 'List my signed-in devices',
    description:
      'The active sessions of the signed-in person, most recently used first. `current` marks this device.\n\nPermission: any signed-in user (own sessions).',
  })
  @ApiOkResponse({ type: SessionListDto, description: 'Active sessions.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    description: 'Reserved: permission checks arrive with roles (P1-2).',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  async listSessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionListDto> {
    const rows = await this.sessions.listFor(user.userId, user.sessionId);
    return {
      sessions: rows.map((row) => ({
        ...row,
        clientType: row.clientType as ClientKind,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
      })),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'revokeSession',
    summary: 'Sign out one of my devices',
    description:
      "Ends one of the signed-in person's own sessions. Its access token stops working at once. Another person's session gives 404.\n\nPermission: any signed-in user (own sessions).",
  })
  @ApiNoContentResponse({ description: 'The session was ended.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'No active session with this id.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    description: 'Reserved: permission checks arrive with roles (P1-2).',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.sessions.revokeOwn(user.userId, sessionId, info);
  }

  // --- Two-step login (authenticator app) ---------------------------------------------------------

  @Post('totp/setup')
  @HttpCode(200)
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'startTotpSetup',
    summary: 'Start two-step login setup',
    description:
      'Creates a secret and returns it with an `otpauth://` link to show as a QR code. Two-step login stays OFF until the first code is confirmed with `/totp/enable`.\n\nPermission: any signed-in user (own account).',
  })
  @ApiOkResponse({
    type: TotpSetupDto,
    description: 'The secret to scan or type into an authenticator app.',
  })
  @ApiProblemResponse('CONFLICT', { detail: 'Two-step login is already switched on.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    description: 'Reserved: permission checks arrive with roles (P1-2).',
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  startTotpSetup(@CurrentUser() user: AuthenticatedUser): Promise<TotpSetupDto> {
    return this.twoFactor.setup(user.userId, this.brand);
  }

  @Post('totp/enable')
  @HttpCode(200)
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'enableTotp',
    summary: 'Switch on two-step login',
    description:
      'Confirms the first 6-digit code from the authenticator app, switches two-step login on, and returns 8 one-time recovery codes. **The recovery codes are shown only once.**\n\nPermission: any signed-in user (own account).',
  })
  @ApiOkResponse({
    type: TotpEnabledDto,
    description: 'Two-step login is on. Save the recovery codes.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'code', message: 'must be 6 digits' }],
  })
  @ApiProblemResponse('INVALID_TOTP_CODE')
  @ApiProblemResponse('CONFLICT', { detail: 'Two-step login is already switched on.' })
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', {
    detail: 'Start the setup first to get a secret.',
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    description: 'Reserved: permission checks arrive with roles (P1-2).',
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async enableTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TotpCodeDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<TotpEnabledDto> {
    return { recoveryCodes: await this.twoFactor.enable(user.userId, dto.code, info) };
  }

  @Post('totp/disable')
  @HttpCode(204)
  @ApiBearerAuth('staff-bearer')
  @ApiOperation({
    operationId: 'disableTotp',
    summary: 'Switch off two-step login',
    description:
      'Needs the password AND a current code (or an unused recovery code), so a stolen session alone cannot remove the protection.\n\nPermission: any signed-in user (own account).',
  })
  @ApiNoContentResponse({ description: 'Two-step login is off.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'code', message: 'code must be longer than or equal to 6 characters' }],
  })
  @ApiProblemResponse('INVALID_CREDENTIALS', { detail: 'The password is not correct.' })
  @ApiProblemResponse('INVALID_TOTP_CODE')
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', { detail: 'Two-step login is not switched on.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    description: 'Reserved: permission checks arrive with roles (P1-2).',
  })
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INTERNAL_ERROR')
  async disableTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TotpDisableDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.twoFactor.disable(user.userId, dto, info);
  }

  /**
   * Find the refresh token in a request. A token in the body (mobile) needs no CSRF check because nothing is sent
   * automatically; a token that came from the cookie (browser) must come with the CSRF header.
   */
  private resolveRefreshToken(
    req: Request,
    bodyToken: string | undefined,
  ): { token: string; viaCookie: boolean } {
    if (bodyToken) return { token: bodyToken, viaCookie: false };
    const cookieToken = readRefreshCookie(req);
    if (!cookieToken) throw new DomainError('INVALID_REFRESH_TOKEN', 'Please sign in again.');
    assertCsrf(req);
    return { token: cookieToken, viaCookie: true };
  }
}
