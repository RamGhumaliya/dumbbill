import { ApiProperty } from '@nestjs/swagger';

/**
 * What the business and branch endpoints return. Plain classes, never database rows.
 */

export class BusinessProfileDto {
  @ApiProperty({ example: 'FitFuel Nutrition' })
  name!: string;

  @ApiProperty({ nullable: true, example: '27AAPFU0939F1ZV' })
  gstin!: string | null;

  @ApiProperty({ nullable: true, example: '27', description: 'Two-digit GST state code.' })
  stateCode!: string | null;

  @ApiProperty({ nullable: true, example: 'Maharashtra' })
  stateName!: string | null;

  @ApiProperty({ nullable: true, example: '12, Ganesh Peth, Near Shaniwar Wada' })
  addressLine!: string | null;

  @ApiProperty({ nullable: true, example: 'Pune' })
  city!: string | null;

  @ApiProperty({ nullable: true, example: '411002' })
  pincode!: string | null;

  @ApiProperty({ nullable: true, example: '+919822012345' })
  phone!: string | null;

  @ApiProperty({
    description: 'True when a logo is saved. Fetch it from GET /v1/business/logo.',
    example: true,
  })
  hasLogo!: boolean;
}

export class GstStateDto {
  @ApiProperty({ example: '27' })
  code!: string;

  @ApiProperty({ example: 'Maharashtra' })
  name!: string;

  @ApiProperty({ example: false })
  isUnionTerritory!: boolean;
}

export class GstStateListDto {
  @ApiProperty({ type: [GstStateDto] })
  states!: GstStateDto[];
}

export class OnboardingStepDto {
  @ApiProperty({
    enum: ['PROFILE', 'BRANCH', 'TEAM'],
    example: 'PROFILE',
    description:
      'Which step. Steps for products, suppliers, the first purchase and a test bill are added by the modules that build them.',
  })
  key!: 'PROFILE' | 'BRANCH' | 'TEAM';

  @ApiProperty({ example: false })
  done!: boolean;
}

export class OnboardingDto {
  @ApiProperty({ type: [OnboardingStepDto] })
  steps!: OnboardingStepDto[];

  @ApiProperty({
    description:
      'True when no GSTIN is on file. The screen warns that bills will be bills of supply, not tax invoices.',
    example: false,
  })
  gstinMissing!: boolean;
}

export class BranchDto {
  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'Kothrud shop' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: 'KOT' })
  invoicePrefix!: string;

  @ApiProperty({ enum: [58, 80], example: 80 })
  printerWidthMm!: number;

  @ApiProperty({ nullable: true, example: '27' })
  stateCode!: string | null;

  @ApiProperty({ nullable: true, example: 'Maharashtra' })
  stateName!: string | null;

  @ApiProperty({ nullable: true, example: '27AAPFU0939F1ZV' })
  gstin!: string | null;

  @ApiProperty({ nullable: true, example: '45, Paud Road' })
  addressLine!: string | null;

  @ApiProperty({ nullable: true, example: 'Pune' })
  city!: string | null;

  @ApiProperty({ nullable: true, example: '411038' })
  pincode!: string | null;

  @ApiProperty({ nullable: true, example: '+919822054321' })
  phone!: string | null;
}

export class BranchLimitDto {
  @ApiProperty({ description: 'Branches the plan allows.', example: 3 })
  max!: number;

  @ApiProperty({
    description: 'Active branches now. Switched-off branches do not count.',
    example: 1,
  })
  used!: number;
}

export class BranchListDto {
  @ApiProperty({
    type: [BranchDto],
    description: 'Branches the caller may use (all of them for owners and "all branches" roles).',
  })
  branches!: BranchDto[];

  @ApiProperty({ type: BranchLimitDto })
  limit!: BranchLimitDto;
}
