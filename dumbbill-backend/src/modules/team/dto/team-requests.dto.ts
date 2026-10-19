import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ALL_PERMISSION_KEYS, PermissionKey } from '../../permissions/permissions.matrix';

/**
 * What the apps send to the team endpoints. Unknown fields are rejected by the global validation pipe, so a client can
 * never smuggle in something like `isOwner` or `tenantId`. Permission names must come from the catalogue
 * (permissions.matrix.ts): a made-up permission is a validation error, not silently ignored.
 */

const normaliseEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const PERMISSION_EXAMPLE = ['products.read', 'pos.sell'];

/** A list of permission keys that must all be known and not repeated. */
function PermissionList(description: string) {
  return function decorate(target: object, key: string): void {
    ApiPropertyOptional({
      description,
      type: [String],
      enum: ALL_PERMISSION_KEYS,
      example: PERMISSION_EXAMPLE,
    })(target, key);
    IsOptional()(target, key);
    IsArray()(target, key);
    ArrayUnique()(target, key);
    ArrayMaxSize(ALL_PERMISSION_KEYS.length)(target, key);
    IsIn(ALL_PERMISSION_KEYS, { each: true, message: 'each item must be a known permission' })(
      target,
      key,
    );
  };
}

export class InviteMemberDto {
  @ApiProperty({
    description: 'Email address of the person. It becomes their sign-in name.',
    example: 'asha@fitfuel.in',
    maxLength: 254,
  })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    description: 'Their full name.',
    example: 'Asha Patil',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({
    description:
      'The role to give them (see `GET /v1/team/roles`). The Owner role cannot be given.',
    example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
  })
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({
    description: 'Branches they may work in. Only used when their role is not "all branches".',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @PermissionList('Extra permissions on top of the role.')
  extraPermissions?: PermissionKey[];

  @PermissionList('Permissions taken away even though the role has them.')
  deniedPermissions?: PermissionKey[];

  @ApiPropertyOptional({
    description:
      "This person's own discount limit in basis points (500 = 5%). Leave out to use the role's.",
    example: 500,
    minimum: 0,
    maximum: 10000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  discountLimitBp?: number;
}

export class UpdateMemberDto {
  @ApiPropertyOptional({
    description: 'Move the person to another role.',
    example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({
    description: 'The full list of branches they may work in (replaces the old list).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @PermissionList('Replaces the list of extra permissions.')
  extraPermissions?: PermissionKey[];

  @PermissionList('Replaces the list of permissions taken away.')
  deniedPermissions?: PermissionKey[];

  @ApiPropertyOptional({
    description: "Own discount limit in basis points, or null to go back to the role's limit.",
    example: 500,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  discountLimitBp?: number | null;

  @ApiPropertyOptional({ description: 'Correct their name.', minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;
}

export class CreateRoleDto {
  @ApiProperty({
    description: 'Name of the role.',
    example: 'Stock keeper',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({
    description: 'What the role is for.',
    example: 'Receives goods and counts stock.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({
    description: 'The permissions the role grants.',
    type: [String],
    enum: ALL_PERMISSION_KEYS,
    example: ['products.read', 'purchases.write', 'stock.adjust'],
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ALL_PERMISSION_KEYS.length)
  @IsIn(ALL_PERMISSION_KEYS, { each: true, message: 'each item must be a known permission' })
  permissions!: PermissionKey[];

  @ApiPropertyOptional({
    description: 'Largest discount this role may give alone, in basis points (500 = 5%).',
    example: 500,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  discountLimitBp?: number;

  @ApiPropertyOptional({
    description: 'True if people in this role may work in every branch.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allBranches?: boolean;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({
    description: 'New name. The built-in Admin and Cashier names cannot be changed.',
    minLength: 2,
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @PermissionList("Replaces the role's permissions.")
  permissions?: PermissionKey[];

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  discountLimitBp?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allBranches?: boolean;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'The token from the link in the invitation email.' })
  @IsString()
  @MaxLength(200)
  token!: string;

  @ApiProperty({
    description: 'The password the person chooses (same rules as sign-up).',
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class SetPinDto {
  @ApiProperty({
    description: 'The account password, asked again so a borrowed screen cannot set a PIN.',
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({
    description: 'A 6-digit approval PIN. Not an obvious one such as 123456 or 000000.',
    example: '804213',
  })
  @Matches(/^\d{6}$/, { message: 'must be exactly 6 digits' })
  pin!: string;
}

export class ClearPinDto {
  @ApiProperty({ description: 'The account password.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;
}

export class VerifyPinDto {
  @ApiProperty({
    description: 'The person approving (see `GET /v1/team/approvers`).',
    example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
  })
  @IsUUID()
  approverUserId!: string;

  @ApiProperty({ description: "The approver's 6-digit PIN, typed by them.", example: '804213' })
  @Matches(/^\d{6}$/, { message: 'must be exactly 6 digits' })
  pin!: string;
}
