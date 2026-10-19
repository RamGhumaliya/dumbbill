import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * What the apps send to the business and branch endpoints. Unknown fields are refused by the global validation
 * pipe, so a client cannot send `tenantId`, `isActive` or `logoKey`. Rules that need the database or the plan (GSTIN
 * check character, state exists, prefix unique, branch limit) are enforced by the services.
 *
 * Optional text fields accept an empty string or null to mean "none"; the services store that as null.
 */

/** Trim text and treat a blank string as "not given". */
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Upper-case and remove spaces (GSTIN, invoice prefix): people paste "27 AAPFU 0939 F1ZV". */
const compactUpper = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const compact = value.replace(/\s+/g, '').toUpperCase();
  return compact === '' ? null : compact;
};

/** Phone numbers: drop the spaces, dashes and brackets people type; keep digits and a leading +. */
const cleanPhone = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const cleaned = value.replace(/[\s\-()]/g, '');
  return cleaned === '' ? null : cleaned;
};

/** Address, state, GSTIN and contact fields that the business and each branch both have. */
export class PlaceDetailsDto {
  @ApiProperty({
    description: 'GST state of this place (two digits). Decides CGST+SGST versus IGST on invoices.',
    example: '27',
    minLength: 2,
    maxLength: 2,
  })
  @IsString()
  @Matches(/^[0-9]{2}$/, { message: 'stateCode must be a two-digit GST state code' })
  stateCode!: string;

  @ApiPropertyOptional({
    description:
      'GSTIN, 15 characters. Optional: leave empty if not registered for GST. The check character is verified and it must start with the state code.',
    example: '27AAPFU0939F1ZV',
    nullable: true,
    maxLength: 15,
  })
  @Transform(compactUpper)
  @IsOptional()
  @IsString()
  @MaxLength(15)
  gstin?: string | null;

  @ApiPropertyOptional({
    description: 'Street address.',
    example: '12, Ganesh Peth, Near Shaniwar Wada',
    nullable: true,
    maxLength: 200,
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string | null;

  @ApiPropertyOptional({ example: 'Pune', nullable: true, maxLength: 80 })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ description: 'Six-digit PIN code.', example: '411002', nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @Matches(/^[1-9][0-9]{5}$/, { message: 'pincode must be a six-digit PIN code' })
  pincode?: string | null;

  @ApiPropertyOptional({
    description: 'Phone number: 8 to 14 digits, optional leading +.',
    example: '+919822012345',
    nullable: true,
  })
  @Transform(cleanPhone)
  @IsOptional()
  @Matches(/^\+?[0-9]{8,14}$/, { message: 'phone must be 8 to 14 digits, with an optional +' })
  phone?: string | null;
}

/** Replace the business profile. */
export class UpdateBusinessDto extends PlaceDetailsDto {
  @ApiProperty({
    description: 'Business name as printed on invoices.',
    example: 'FitFuel Nutrition',
    minLength: 2,
    maxLength: 120,
  })
  @Transform(blankToNull)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

/** Create a branch, or replace all of a branch's details. */
export class BranchDetailsDto extends PlaceDetailsDto {
  @ApiProperty({
    description: 'Branch name, unique inside the business.',
    example: 'Kothrud shop',
    minLength: 2,
    maxLength: 80,
  })
  @Transform(blankToNull)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    description:
      'Printed at the start of every invoice number of this branch (for example KOT-000123). 1 to 6 capital letters or digits, unique inside the business.',
    example: 'KOT',
    minLength: 1,
    maxLength: 6,
  })
  @Transform(compactUpper)
  @IsString()
  @Matches(/^[A-Z0-9]{1,6}$/, { message: 'invoicePrefix must be 1 to 6 capital letters or digits' })
  invoicePrefix!: string;

  @ApiProperty({ description: 'Receipt paper width in millimetres.', enum: [58, 80], example: 80 })
  @IsIn([58, 80])
  printerWidthMm!: 58 | 80;
}
