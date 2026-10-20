import { ApiProperty } from '@nestjs/swagger';

/**
 * What the stock endpoints return. Plain classes, never database rows.
 *
 * COST SECRECY (hard rule 3): the `...CashierDto` classes have NO field for cost, value or average cost. The `...AdminDto`
 * classes add them and are returned ONLY to people who hold `products.cost.read`. Separate classes on purpose; a test
 * scans every stock response a cashier can get for cost-like keys.
 */

export class StockRowCashierDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty({ example: 'Gold Standard 100% Whey' })
  productName!: string;

  @ApiProperty({ example: 'Optimum Nutrition' })
  brand!: string;

  @ApiProperty({ example: '2 kg / Chocolate' })
  variant!: string;

  @ApiProperty({ nullable: true, example: '748927052145' })
  barcode!: string | null;

  @ApiProperty({ example: 18, description: 'Units on hand at this branch.' })
  qty!: number;

  @ApiProperty({
    nullable: true,
    example: 6,
    description: 'The low-stock level, or null when none is set.',
  })
  minQty!: number | null;

  @ApiProperty({
    description: 'True when a low-stock level is set and the stock is at or below it.',
    example: false,
  })
  isLow!: boolean;
}

/** Returned only to people with products.cost.read. */
export class StockRowAdminDto extends StockRowCashierDto {
  @ApiProperty({
    example: 250025,
    description: 'CONFIDENTIAL. The weighted average cost per unit, in paise.',
  })
  wacPaise!: number;

  @ApiProperty({
    example: 4500450,
    description: 'CONFIDENTIAL. What the stock on hand is worth, in paise.',
  })
  valuePaise!: number;
}

export class StockListDto {
  @ApiProperty()
  branchId!: string;

  @ApiProperty({
    type: [StockRowCashierDto],
    description:
      'StockRowAdminDto items for callers with products.cost.read, StockRowCashierDto items for everyone else.',
  })
  items!: StockRowCashierDto[] | StockRowAdminDto[];

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class LedgerEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({
    enum: [
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
    ],
  })
  type!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ example: 'Gold Standard 100% Whey' })
  productName!: string;

  @ApiProperty({ example: 24, description: 'Units added (positive) or removed (negative).' })
  qtyDelta!: number;

  @ApiProperty({ example: 42, description: 'Units on hand after this movement.' })
  qtyAfter!: number;

  @ApiProperty({ nullable: true, example: 'WH2410A' })
  batchNo!: string | null;

  @ApiProperty({ nullable: true, example: '2027-09-30' })
  expiryDate!: string | null;

  @ApiProperty({
    example: 'PURCHASE',
    description: 'What caused it: PURCHASE, ADJUSTMENT, TRANSFER, SUPPLIER_RETURN, WRITE_OFF.',
  })
  refType!: string;

  @ApiProperty({ nullable: true })
  refId!: string | null;

  @ApiProperty({ nullable: true, example: 'DAMAGE' })
  reason!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ nullable: true, example: 'Ravi Mehta' })
  createdByName!: string | null;
}

/** Returned only to people with products.cost.read. */
export class LedgerEntryAdminDto extends LedgerEntryDto {
  @ApiProperty({
    example: 250025,
    description: 'CONFIDENTIAL. Cost of one unit in this movement, in paise.',
  })
  unitCostPaise!: number;

  @ApiProperty({
    example: 6000600,
    description: 'CONFIDENTIAL. Value added (positive) or removed (negative), in paise.',
  })
  valueDeltaPaise!: number;

  @ApiProperty({
    example: 250025,
    description: 'CONFIDENTIAL. Average cost per unit after this movement, in paise.',
  })
  wacAfterPaise!: number;

  @ApiProperty({
    example: 10501050,
    description: 'CONFIDENTIAL. Value of the stock on hand after this movement, in paise.',
  })
  valueAfterPaise!: number;
}

export class LedgerListDto {
  @ApiProperty({
    type: [LedgerEntryDto],
    description:
      'LedgerEntryAdminDto items for callers with products.cost.read, LedgerEntryDto items for everyone else. Newest first.',
  })
  items!: LedgerEntryDto[] | LedgerEntryAdminDto[];

  @ApiProperty({ example: 300 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class StockChangeDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ example: 20, description: 'Units on hand before.' })
  qtyBefore!: number;

  @ApiProperty({ example: 18, description: 'Units on hand after.' })
  qtyAfter!: number;
}

export class ThresholdDto {
  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ example: 6 })
  minQty!: number;
}

export class StockSettingsResponseDto {
  @ApiProperty({ example: 60 })
  nearExpiryDays!: number;
}

export class LowStockAlertDto {
  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ example: 2 })
  qty!: number;

  @ApiProperty({ example: 6 })
  minQty!: number;
}

export class ExpiryAlertDto {
  @ApiProperty()
  batchId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ nullable: true, example: 'WH2410A' })
  batchNo!: string | null;

  @ApiProperty({ example: '2026-12-01' })
  expiryDate!: string;

  @ApiProperty({ example: 12 })
  qtyRemaining!: number;

  @ApiProperty({ example: 43, description: 'Days until expiry. Negative once it has expired.' })
  daysLeft!: number;
}

export class AlertsDto {
  @ApiProperty({ example: 60 })
  nearExpiryDays!: number;

  @ApiProperty({ type: [LowStockAlertDto] })
  lowStock!: LowStockAlertDto[];

  @ApiProperty({
    type: [ExpiryAlertDto],
    description: 'Batches that expire within the window, soonest first.',
  })
  nearExpiry!: ExpiryAlertDto[];

  @ApiProperty({
    type: [ExpiryAlertDto],
    description: 'Batches already past their expiry date that still have units.',
  })
  expired!: ExpiryAlertDto[];
}

export class VerifyProblemDto {
  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ example: 'Stock level says 12 but the ledger adds up to 11.' })
  problem!: string;
}

export class VerifyDto {
  @ApiProperty({
    description: 'True when the stock levels and batches agree with the ledger everywhere.',
  })
  ok!: boolean;

  @ApiProperty({ example: 120 })
  checkedPositions!: number;

  @ApiProperty({ type: [VerifyProblemDto] })
  problems!: VerifyProblemDto[];
}

export class RebuildDto {
  @ApiProperty({
    example: 2,
    description: 'How many stock levels were corrected to match the ledger.',
  })
  levelsFixed!: number;

  @ApiProperty({ example: 1, description: 'How many batches were corrected to match the ledger.' })
  batchesFixed!: number;
}

export class TransferLineDetailDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ example: 12 })
  qty!: number;

  @ApiProperty({ nullable: true })
  batchNo!: string | null;

  @ApiProperty({ nullable: true })
  expiryDate!: string | null;
}

export class TransferDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fromBranchId!: string;

  @ApiProperty()
  fromBranchName!: string;

  @ApiProperty()
  toBranchId!: string;

  @ApiProperty()
  toBranchName!: string;

  @ApiProperty({ enum: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ nullable: true })
  receivedAt!: string | null;

  @ApiProperty({ nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({ type: [TransferLineDetailDto] })
  lines!: TransferLineDetailDto[];
}

export class TransferListDto {
  @ApiProperty({
    type: [TransferDto],
    description: 'Newest first, up to 200. Transfers where either branch is one you may use.',
  })
  items!: TransferDto[];
}
