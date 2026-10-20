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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_PAISE } from '../../catalogue/domain/money';

/**
 * What the apps send to the stock endpoints. Unknown fields are refused by the global validation pipe. Business rules
 * (enough stock, the batch really expired, the count differs from the books) are checked by the services.
 */

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? null : text;
};
/** Query strings arrive as text; "true" means true. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

export class ListStockQueryDto {
  @ApiProperty({ description: 'The branch whose stock to show.' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ description: 'Search in name, brand, variant, SKU and barcode.' })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Only this category.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'true = only products at or below their low-stock level.' })
  @Transform(toBoolean)
  @IsOptional()
  lowOnly?: boolean;

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

export const LEDGER_TYPES = [
  'PURCHASE',
  'SALE',
  'SALE_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TRANSFER_CANCEL',
  'SUPPLIER_RETURN',
  'EXPIRY_WRITE_OFF',
] as const;

export class LedgerQueryDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ enum: LEDGER_TYPES })
  @IsOptional()
  @IsIn(LEDGER_TYPES)
  type?: (typeof LEDGER_TYPES)[number];

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

export const ADJUSTMENT_REASONS = ['RECOUNT', 'DAMAGE', 'LOST', 'OTHER'] as const;

/** "I counted this many": the stock is set to the count, and the difference is recorded with a reason. */
export class AdjustStockDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 18, description: 'How many units you actually counted.' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  countedQty!: number;

  @ApiProperty({ enum: ADJUSTMENT_REASONS, example: 'RECOUNT' })
  @IsIn(ADJUSTMENT_REASONS)
  reason!: (typeof ADJUSTMENT_REASONS)[number];

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 300,
    example: 'Three tubs split in the delivery',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiPropertyOptional({
    description:
      'Take the missing units from this batch (when the count is lower), or add the found units to it (when higher). Leave out to use the batches that expire first / the shared "no batch" lot.',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({
    description:
      'Only used when the count is HIGHER and the product has no average cost yet: what each found unit is worth, in paise. Otherwise found units are valued at the current average cost.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PAISE)
  unitCostPaise?: number;
}

/** Write off an expired batch. */
export class WriteOffDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @IsUUID()
  batchId!: string;

  @ApiPropertyOptional({
    example: 4,
    description: 'How many to write off. Leave out for everything left in the batch.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty?: number;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class SetThresholdDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({
    example: 6,
    description:
      'The product shows in the low-stock alerts at or below this many units. 0 switches the alert off.',
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minQty!: number;
}

export class StockSettingsDto {
  @ApiProperty({
    example: 60,
    minimum: 1,
    maximum: 365,
    description: 'A batch is "near expiry" this many days before its expiry date.',
  })
  @IsInt()
  @Min(1)
  @Max(365)
  nearExpiryDays!: number;
}

export class AlertsQueryDto {
  @ApiPropertyOptional({ description: 'Only this branch. Leave out for every branch you may use.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class TransferLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;
}

/** Send goods to another branch. They leave now and are "in transit" until the other branch confirms. */
export class CreateTransferDto {
  @ApiProperty({ description: 'The branch the goods leave. You must be allowed to use it.' })
  @IsUUID()
  fromBranchId!: string;

  @ApiProperty({ description: 'The branch the goods go to.' })
  @IsUUID()
  toBranchId!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiProperty({ type: [TransferLineDto], minItems: 1, maxItems: 200 })
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  lines!: TransferLineDto[];
}

export class ListTransfersQueryDto {
  @ApiPropertyOptional({ enum: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['IN_TRANSIT', 'RECEIVED', 'CANCELLED'])
  status?: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
}
