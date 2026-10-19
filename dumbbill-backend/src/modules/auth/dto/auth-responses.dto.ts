import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientKind } from './auth-requests.dto';

/**
 * What the auth endpoints return. These are separate classes, never database rows, so a secret column
 * (password hash, TOTP secret, token hashes) can never leak by accident: a field that is not declared here
 * cannot be returned.
 */

/** Answer for requests that must not reveal whether an account exists (signup, resend, forgot password). */
export class AcceptedDto {
  @ApiProperty({
    description: 'Always the same text, whether or not the email has an account.',
    example: 'If this email can be used, a message is on its way.',
  })
  message!: string;
}

export class AuthUserDto {
  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'ravi@fitfuel.in' })
  email!: string;

  @ApiProperty({ example: 'Ravi Mehta' })
  fullName!: string;

  @ApiProperty({ description: 'True for the person who created the business.', example: true })
  isOwner!: boolean;

  @ApiProperty({
    description: 'Whether two-step login (authenticator app) is switched on.',
    example: false,
  })
  totpEnabled!: boolean;
}

export class AuthTenantDto {
  @ApiProperty({ example: '0192a3b4-1111-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'FitFuel Nutrition' })
  name!: string;

  @ApiProperty({ enum: ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'], example: 'TRIAL' })
  status!: string;

  @ApiPropertyOptional({
    description: 'End of the free trial (ISO-8601 UTC).',
    example: '2026-11-01T09:30:00.000Z',
    nullable: true,
  })
  trialEndsAt!: string | null;
}

/** What the signed-in person may do. The API enforces it; the apps use it to show or hide buttons. */
export class AccessSummaryDto {
  @ApiPropertyOptional({ description: 'Name of their role.', example: 'Cashier', nullable: true })
  roleName!: string | null;

  @ApiProperty({
    description: 'Permission keys they hold (see `GET /v1/team/options` for the catalogue).',
    type: [String],
    example: ['products.read', 'pos.sell', 'discount.apply'],
  })
  permissions!: string[];

  @ApiProperty({
    description: 'Largest discount they may give alone, in basis points (500 = 5%).',
    example: 500,
  })
  discountLimitBp!: number;

  @ApiProperty({ description: 'True if they may work in every branch.', example: false })
  allBranches!: boolean;

  @ApiProperty({
    description: 'Branches they are assigned to (meaningful when `allBranches` is false).',
    type: [String],
  })
  branchIds!: string[];
}

/** Returned by sign-in. */
export class LoginResponseDto {
  @ApiProperty({
    description:
      'Send as `Authorization: Bearer <accessToken>` on every request. Lasts 15 minutes. Keep it in memory only.',
  })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ description: 'Seconds until the access token expires.', example: 900 })
  expiresInSeconds!: number;

  @ApiPropertyOptional({
    description:
      'Only for `clientType: MOBILE`. Store in secure storage; use it once on `/v1/auth/refresh`. Browser apps never see it (it is an httpOnly cookie).',
  })
  refreshToken?: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({ type: AuthTenantDto })
  tenant!: AuthTenantDto;

  @ApiProperty({ type: AccessSummaryDto })
  access!: AccessSummaryDto;
}

/** Returned by token refresh. */
export class RefreshResponseDto {
  @ApiProperty({ description: 'A new access token. Lasts 15 minutes.' })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 900 })
  expiresInSeconds!: number;

  @ApiPropertyOptional({
    description:
      'MOBILE only: the NEXT refresh token. The one just used no longer works. Absent in the rare double-refresh case, when the earlier response already delivered the new one.',
  })
  refreshToken?: string;
}

/** The signed-in person and their business. */
export class MeResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({ type: AuthTenantDto })
  tenant!: AuthTenantDto;

  @ApiProperty({ type: AccessSummaryDto })
  access!: AccessSummaryDto;
}

export class SessionDto {
  @ApiProperty({ example: '0192a3b4-2222-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ description: 'A label to recognise the device.', example: 'Chrome on Windows' })
  deviceLabel!: string;

  @ApiProperty({ enum: ClientKind, example: ClientKind.WEB })
  clientType!: ClientKind;

  @ApiProperty({ nullable: true, example: '103.21.58.14' })
  ipAddress!: string | null;

  @ApiProperty({ example: '2026-10-18T09:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-18T11:05:00.000Z' })
  lastUsedAt!: string;

  @ApiProperty({ description: 'True for the session that made this request.', example: true })
  current!: boolean;
}

export class SessionListDto {
  @ApiProperty({ type: [SessionDto] })
  sessions!: SessionDto[];
}

export class TotpSetupDto {
  @ApiProperty({
    description: 'The secret in Base32, for typing into an authenticator app by hand.',
    example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  })
  secret!: string;

  @ApiProperty({
    description: 'An `otpauth://` link. Show it as a QR code for the authenticator app to scan.',
    example: 'otpauth://totp/Dumbbill:ravi%40fitfuel.in?secret=JBSWY3DPEHPK3PXP&issuer=Dumbbill',
  })
  otpAuthUri!: string;
}

export class TotpEnabledDto {
  @ApiProperty({
    description:
      'One-time recovery codes. Shown ONCE, ask the person to save them somewhere safe. Each works one time.',
    type: [String],
    example: ['K7F2M-9QXPA', 'H4T8N-2WZCD'],
  })
  recoveryCodes!: string[];
}
