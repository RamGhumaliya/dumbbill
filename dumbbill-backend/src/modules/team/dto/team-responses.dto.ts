import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ALL_PERMISSION_KEYS } from '../../permissions/permissions.matrix';

/**
 * What the team endpoints return. Separate classes, never database rows: a password hash, PIN hash, TOTP secret or
 * token hash cannot be returned because no class here has a field for it.
 */

export class RoleDto {
  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'Cashier' })
  name!: string;

  @ApiProperty({ example: 'Sells at the till. Never sees purchase cost or profit.' })
  description!: string;

  @ApiProperty({
    description:
      'OWNER, ADMIN or CASHIER for the built-in roles, null for roles the business made.',
    nullable: true,
    enum: ['OWNER', 'ADMIN', 'CASHIER'],
    example: 'CASHIER',
  })
  systemKey!: string | null;

  @ApiProperty({
    description: 'True for the Owner role: it always holds every permission and cannot be edited.',
    example: false,
  })
  locked!: boolean;

  @ApiProperty({
    type: [String],
    enum: ALL_PERMISSION_KEYS,
    example: ['products.read', 'pos.sell', 'discount.apply'],
    description: 'The permissions it grants. Empty for the Owner role, which holds all of them.',
  })
  permissions!: string[];

  @ApiProperty({
    description: 'Largest discount it may give alone, in basis points (500 = 5%).',
    example: 500,
  })
  discountLimitBp!: number;

  @ApiProperty({
    description: 'True if people in this role may work in every branch.',
    example: false,
  })
  allBranches!: boolean;

  @ApiProperty({ description: 'How many people have this role.', example: 4 })
  memberCount!: number;
}

export class RoleListDto {
  @ApiProperty({ type: [RoleDto] })
  roles!: RoleDto[];
}

export class MemberRoleDto {
  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'Cashier' })
  name!: string;
}

export class EffectiveAccessDto {
  @ApiProperty({
    type: [String],
    enum: ALL_PERMISSION_KEYS,
    description: 'What the person can actually do: role + extras - taken away.',
  })
  permissions!: string[];

  @ApiProperty({ example: 500 })
  discountLimitBp!: number;

  @ApiProperty({ example: false })
  allBranches!: boolean;
}

export class MemberDto {
  @ApiProperty({ example: '0192a3b4-2222-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'asha@fitfuel.in' })
  email!: string;

  @ApiProperty({ example: 'Asha Patil' })
  fullName!: string;

  @ApiProperty({
    enum: ['INVITED', 'ACTIVE', 'DISABLED'],
    description: 'INVITED: has not accepted yet. DISABLED: access removed.',
    example: 'ACTIVE',
  })
  status!: string;

  @ApiProperty({ description: 'True for the person who created the business.', example: false })
  isOwner!: boolean;

  @ApiProperty({ type: MemberRoleDto, nullable: true })
  role!: MemberRoleDto | null;

  @ApiProperty({
    type: [String],
    description: 'Branches assigned to them (used when their role is not "all branches").',
  })
  branchIds!: string[];

  @ApiProperty({
    type: [String],
    enum: ALL_PERMISSION_KEYS,
    description: 'Extra permissions on top of the role.',
  })
  extraPermissions!: string[];

  @ApiProperty({
    type: [String],
    enum: ALL_PERMISSION_KEYS,
    description: 'Permissions taken away.',
  })
  deniedPermissions!: string[];

  @ApiProperty({
    nullable: true,
    description: "Their own discount limit, or null to use the role's.",
    example: null,
  })
  discountLimitBp!: number | null;

  @ApiProperty({ type: EffectiveAccessDto })
  effective!: EffectiveAccessDto;

  @ApiProperty({
    description: 'Whether an approval PIN is set (the PIN itself is never returned).',
    example: true,
  })
  hasPin!: boolean;

  @ApiProperty({ description: 'Whether two-step sign-in is on.', example: false })
  totpEnabled!: boolean;

  @ApiProperty({ nullable: true, example: '2026-10-18T09:30:00.000Z' })
  lastLoginAt!: string | null;

  @ApiProperty({ example: '2026-10-01T09:30:00.000Z' })
  createdAt!: string;

  @ApiPropertyOptional({ nullable: true, example: null })
  disabledAt!: string | null;
}

export class MemberListDto {
  @ApiProperty({ type: [MemberDto] })
  members!: MemberDto[];
}

export class PermissionInfoDto {
  @ApiProperty({ example: 'products.cost.read' })
  key!: string;

  @ApiProperty({ example: 'Products' })
  group!: string;

  @ApiProperty({ example: 'See purchase cost' })
  label!: string;

  @ApiProperty({ example: 'See what products cost to buy. Never give this to cashiers.' })
  description!: string;

  @ApiProperty({ description: 'True if it reveals cost or profit.', example: true })
  confidential!: boolean;
}

export class BranchOptionDto {
  @ApiProperty({ example: '0192a3b4-3333-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'Main branch' })
  name!: string;
}

export class SeatsDto {
  @ApiProperty({
    description: 'People the plan allows (switched-off people do not count).',
    example: 3,
  })
  max!: number;

  @ApiProperty({ description: 'People counted now (active and invited).', example: 2 })
  used!: number;
}

/** Everything the team screen needs to draw its forms. */
export class TeamOptionsDto {
  @ApiProperty({ type: [RoleDto] })
  roles!: RoleDto[];

  @ApiProperty({ type: [BranchOptionDto] })
  branches!: BranchOptionDto[];

  @ApiProperty({ type: [PermissionInfoDto], description: 'The catalogue of permissions.' })
  permissions!: PermissionInfoDto[];

  @ApiProperty({ type: SeatsDto })
  seats!: SeatsDto;
}

export class ApproverDto {
  @ApiProperty({ example: '0192a3b4-4444-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'Ravi Mehta' })
  fullName!: string;
}

export class ApproverListDto {
  @ApiProperty({
    type: [ApproverDto],
    description: 'People who can approve discounts and have set a PIN.',
  })
  approvers!: ApproverDto[];
}

export class PinApprovedDto {
  @ApiProperty({ type: ApproverDto })
  approver!: ApproverDto;
}
