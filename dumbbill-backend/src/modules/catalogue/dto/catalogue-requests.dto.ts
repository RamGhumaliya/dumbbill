import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_PAISE } from '../domain/money';

/**
 * What the apps send to the catalogue endpoints. Unknown fields are refused by the global validation pipe, so a client
 * cannot send `tenantId`, `imageKey` or `isActive`. Shape is checked here; business rules (HSN required with a GSTIN,
 * price not above MRP, unique barcode) are checked by the services, which return field-by-field errors.
 *
 * Optional text accepts an empty string or null to mean "none".
 */

/** Trim text; a blank string means "not given". */
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Trim text but keep an empty string (name-like fields that default to ""). */
const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The descriptive fields a product has, without prices. */
export class ProductDetailsDto {
  @ApiProperty({ example: 'Gold Standard 100% Whey', minLength: 2, maxLength: 150 })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({
    example: 'Optimum Nutrition',
    maxLength: 80,
    description: 'Empty when there is no brand.',
  })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @ApiPropertyOptional({
    example: '2 kg / Double Rich Chocolate',
    maxLength: 80,
    description:
      'The variant. Every variant is its own product with its own barcode and price, sharing the name and brand.',
  })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  variant?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'One of your categories (GET /v1/products/options).',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({
    example: 'ON-GS-2KG-CHOC',
    nullable: true,
    description: 'Your own stock code. Unique per business.',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sku?: string | null;

  @ApiPropertyOptional({
    example: '748927052145',
    nullable: true,
    description: 'The code printed on the pack. 3 to 32 letters or digits. Unique per business.',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  barcode?: string | null;

  @ApiPropertyOptional({
    example: '21069099',
    nullable: true,
    description: 'HSN code: 4, 6 or 8 digits. Required when your business has a GSTIN.',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(8)
  hsn?: string | null;

  @ApiPropertyOptional({
    example: 1800,
    nullable: true,
    description:
      'GST rate in basis points (1800 = 18%). Must be one of the rates from GET /v1/products/options. Required when your business has a GSTIN.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  gstRateBp?: number | null;

  @ApiPropertyOptional({
    example: 249900,
    nullable: true,
    description:
      'CONFIDENTIAL. What the item costs you, in paise. Only people with products.cost.read may send it (others get 403). Omit to leave it unchanged.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PAISE)
  purchaseCostPaise?: number | null;
}

/** Create a product with its first price (needs products.write AND pricing.write). */
export class CreateProductDto extends ProductDetailsDto {
  @ApiProperty({ example: 349900, description: 'MRP (maximum retail price) in paise.' })
  @IsInt()
  @Min(1)
  @Max(MAX_PAISE)
  mrpPaise!: number;

  @ApiProperty({ example: 299900, description: 'Your selling price in paise. Not above the MRP.' })
  @IsInt()
  @Min(1)
  @Max(MAX_PAISE)
  pricePaise!: number;
}

/** Replace a product's descriptive fields (prices change through the price endpoint, so each change is recorded). */
export class UpdateProductDto extends ProductDetailsDto {}

/** Change a product's price. Always recorded in the price history with who and why. */
export class ChangePriceDto {
  @ApiProperty({ example: 349900, description: 'MRP in paise.' })
  @IsInt()
  @Min(1)
  @Max(MAX_PAISE)
  mrpPaise!: number;

  @ApiProperty({ example: 289900, description: 'Selling price in paise. Not above the MRP.' })
  @IsInt()
  @Min(1)
  @Max(MAX_PAISE)
  pricePaise!: number;

  @ApiProperty({
    example: 'Diwali offer',
    minLength: 3,
    maxLength: 200,
    description: 'Why the price changes.',
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'When the new price starts. Omit for "now". A future time schedules the change.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'Pre-workout', minLength: 2, maxLength: 80 })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: '21069099',
    nullable: true,
    description: 'Suggested HSN for new products in it.',
  })
  @Transform(blankToNull)
  @IsOptional()
  @Matches(/^([0-9]{4}|[0-9]{6}|[0-9]{8})$/, { message: 'defaultHsn must have 4, 6 or 8 digits' })
  defaultHsn?: string | null;

  @ApiPropertyOptional({
    example: 1800,
    nullable: true,
    description: 'Suggested GST rate in basis points.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultGstRateBp?: number | null;
}

/** Filters for the product list. */
export class ListProductsQueryDto {
  @ApiPropertyOptional({
    description: 'Search in name, brand, variant, SKU and barcode.',
    example: 'whey',
  })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Only this category.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';

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
