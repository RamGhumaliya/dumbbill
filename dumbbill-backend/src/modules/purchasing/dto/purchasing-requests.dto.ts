import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { MAX_PAISE } from '../../catalogue/domain/money';

/**
 * What the apps send to the supplier, purchase and supplier-return endpoints. Unknown fields are refused by the global
 * validation pipe. Shape is checked here; business rules (expiry not in the past, unique invoice number, stock available)
 * are checked by the services, which return field-by-field errors.
 */

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? null : text;
};
const compactUpper = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.replace(/\s+/g, '').toUpperCase();
  return text === '' ? null : text;
};
const cleanPhone = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.replace(/[\s\-()]/g, '');
  return text === '' ? null : text;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Create a supplier, or replace all of a supplier's details. */
export class SupplierDetailsDto {
  @ApiProperty({
    example: 'Nutri Distributors Pvt Ltd',
    minLength: 2,
    maxLength: 120,
    description: 'Unique inside the business.',
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: '27AAPFU0939F1ZV',
    nullable: true,
    description: 'Their GSTIN (15 characters). The check character is verified.',
  })
  @Transform(compactUpper)
  @IsOptional()
  @IsString()
  @MaxLength(15)
  gstin?: string | null;

  @ApiPropertyOptional({ example: '+919822012345', nullable: true })
  @Transform(cleanPhone)
  @IsOptional()
  @Matches(/^\+?[0-9]{8,14}$/, { message: 'phone must be 8 to 14 digits, with an optional +' })
  phone?: string | null;

  @ApiPropertyOptional({ example: 'orders@nutridist.in', nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be an email address' })
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 80 })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description: "Anything worth remembering: payment terms, the rep's name.",
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class ListSuppliersQueryDto {
  @ApiPropertyOptional({ description: 'Search in name, GSTIN and phone.' })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}

/** One line of a supplier's bill. */
export class PurchaseLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 24, description: 'Units received.' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;

  @ApiProperty({
    example: 249900,
    description: 'What the supplier charges per unit, in paise (before the extra costs).',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_PAISE)
  unitCostPaise!: number;

  @ApiPropertyOptional({
    example: 'WH2410A',
    nullable: true,
    maxLength: 40,
    description: 'The batch (lot) number printed on the pack.',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  batchNo?: string | null;

  @ApiPropertyOptional({
    example: '2027-09-30',
    nullable: true,
    description: 'Expiry date, YYYY-MM-DD. Today or later.',
  })
  @Transform(blankToNull)
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'expiryDate must be a date like 2027-09-30' })
  expiryDate?: string | null;
}

/** Record a supplier's bill: the goods go into stock and the supplier is owed the total. */
export class CreatePurchaseDto {
  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ description: 'The branch the goods arrived at.' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({
    example: 'NDP/2410/0417',
    maxLength: 60,
    description:
      "The supplier's own invoice number. The same number cannot be entered twice for one supplier.",
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  invoiceRef!: string;

  @ApiProperty({
    example: '2026-10-19',
    description: "The date on the supplier's invoice, YYYY-MM-DD.",
  })
  @Matches(DATE_ONLY, { message: 'invoiceDate must be a date like 2026-10-19' })
  invoiceDate!: string;

  @ApiPropertyOptional({
    example: 150000,
    default: 0,
    description:
      'Freight and other extra costs on the bill, in paise. Spread over the lines in proportion to their value.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PAISE)
  otherCostPaise?: number;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({ type: [PurchaseLineDto], minItems: 1, maxItems: 200 })
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  lines!: PurchaseLineDto[];
}

export class ListPurchasesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

/** One kind of goods going back to a supplier. */
export class SupplierReturnLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    description: 'Send back from this batch. Leave out to take from the batches that expire first.',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiProperty({ example: 6 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;

  @ApiProperty({
    example: 249900,
    description: 'The credit the supplier gives per unit, in paise.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_PAISE)
  unitCreditPaise!: number;
}

/** Send goods back to a supplier. Stock goes down at its average cost and a numbered debit note records the credit. */
export class CreateSupplierReturnDto {
  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({
    description: 'The purchase these goods came from, if you want the debit note to point at it.',
  })
  @IsOptional()
  @IsUUID()
  purchaseId?: string;

  @ApiProperty({ example: 'Damaged in transit', minLength: 3, maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({ type: [SupplierReturnLineDto], minItems: 1, maxItems: 200 })
  @ValidateNested({ each: true })
  @Type(() => SupplierReturnLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  lines!: SupplierReturnLineDto[];
}
