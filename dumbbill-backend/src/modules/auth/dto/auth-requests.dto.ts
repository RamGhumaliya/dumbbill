import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * What the apps send to the auth endpoints. The global validation pipe rejects unknown fields
 * (`forbidNonWhitelisted`), so a client can never smuggle in extras such as `tenantId` or `role`.
 *
 * Passwords are limited to 200 characters HERE only to stop absurdly large bodies; the real rules (10 to 128
 * characters, not common, not breached) are applied by the password policy so the messages are friendly.
 */

/** Emails are compared in lower case with no surrounding spaces, so "Ram@Shop.in " and "ram@shop.in" are one account. */
const normaliseEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Which kind of app is signing in. It decides how the refresh token is handed over. */
export enum ClientKind {
  /** The browser apps (owner dashboard, POS). The refresh token goes in a protected cookie, never in JSON. */
  WEB = 'WEB',
  /** The Flutter apps. The refresh token is returned in the JSON and kept in the phone's secure storage. */
  MOBILE = 'MOBILE',
}

export class SignupDto {
  @ApiProperty({
    description: 'Name of the shop or business.',
    example: 'FitFuel Nutrition',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  businessName!: string;

  @ApiProperty({
    description: 'Full name of the owner.',
    example: 'Ravi Mehta',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerName!: string;

  @ApiProperty({
    description: 'Owner email address. It becomes the sign-in name.',
    example: 'ravi@fitfuel.in',
    maxLength: 254,
  })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    description: 'At least 10 characters, no more than 128. Not a common or breached password.',
    example: 'correct horse battery staple',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty({
    description: 'The token from the link in the verification email.',
    example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b.k9X2mQ7vR4tY8uI1oP3aS6dF0gH5jK2lZ9xC4vB7nM1',
  })
  @IsString()
  @MaxLength(200)
  token!: string;
}

export class EmailOnlyDto {
  @ApiProperty({
    description: 'The account email address.',
    example: 'ravi@fitfuel.in',
    maxLength: 254,
  })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ravi@fitfuel.in', maxLength: 254 })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @ApiProperty({
    enum: ClientKind,
    description:
      'WEB: refresh token is set as an httpOnly cookie. MOBILE: it is returned in the response body.',
    example: ClientKind.WEB,
  })
  @IsEnum(ClientKind)
  clientType!: ClientKind;

  @ApiPropertyOptional({
    description:
      'The 6-digit code from the authenticator app. Send it only when the previous attempt answered `TOTP_REQUIRED`.',
    example: '492039',
  })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'must be 6 digits' })
  totpCode?: string;

  @ApiPropertyOptional({
    description:
      'One of the one-time recovery codes, for when the phone is lost. Use instead of `totpCode`.',
    example: 'K7F2M-9QXPA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;
}

export class RefreshDto {
  @ApiPropertyOptional({
    description:
      'MOBILE apps send their refresh token here. Browser apps send nothing: the cookie is used (and the `X-CSRF-Token` header is required).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the link in the reset email.' })
  @IsString()
  @MaxLength(200)
  token!: string;

  @ApiProperty({
    description: 'The new password (same rules as signup).',
    example: 'a new long passphrase 2026',
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    description:
      'The password used now. Asked again so a borrowed, unlocked screen cannot change it.',
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ description: 'The new password (same rules as signup).', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  newPassword!: string;
}

export class TotpCodeDto {
  @ApiProperty({
    description: 'The current 6-digit code from the authenticator app.',
    example: '492039',
  })
  @Matches(/^\d{6}$/, { message: 'must be 6 digits' })
  code!: string;
}

export class TotpDisableDto {
  @ApiProperty({ description: 'The account password.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @ApiProperty({
    description: 'A current 6-digit code, or an unused recovery code.',
    example: '492039',
    maxLength: 32,
  })
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code!: string;
}
