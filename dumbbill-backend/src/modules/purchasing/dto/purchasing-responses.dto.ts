import { ApiProperty } from '@nestjs/swagger';

/**
 * What the purchasing endpoints return. Plain classes, never database rows. These routes need `purchases.write`, so
 * costs are part of the answer: a person who may record a purchase already knows what it cost. Cashiers cannot reach them.
 */

export class SupplierDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Nutri Distributors Pvt Ltd' })
  name!: string;

  @ApiProperty({ nullable: true, example: '27AAPFU0939F1ZV' })
  gstin!: string | null;

  @ApiProperty({ nullable: true, example: '+919822012345' })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  addressLine!: string | null;

  @ApiProperty({ nullable: true })
  city!: string | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    example: 1250000,
    description:
      'What the shop owes this supplier, in paise: all their bills minus the credit from debit notes. Payments are not recorded yet, so this is the total before any payment.',
  })
  balancePaise!: number;
}

export class SupplierListDto {
  @ApiProperty({ type: [SupplierDto] })
  suppliers!: SupplierDto[];
}

export class PurchaseLineDetailDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty({ example: 'Gold Standard 100% Whey' })
  productName!: string;

  @ApiProperty({ example: 'Optimum Nutrition' })
  brand!: string;

  @ApiProperty({ example: '2 kg / Chocolate' })
  variant!: string;

  @ApiProperty({ example: 24 })
  qty!: number;

  @ApiProperty({ example: 249900, description: "The supplier's price per unit, in paise." })
  unitCostPaise!: number;

  @ApiProperty({ example: 1500, description: "This line's share of the extra costs, in paise." })
  allocatedCostPaise!: number;

  @ApiProperty({
    example: 5998500,
    description: 'qty x unit price + share of extra costs: the landed cost of the line, in paise.',
  })
  lineTotalPaise!: number;

  @ApiProperty({
    example: 250025,
    description: 'The landed cost of one unit (line total / qty), rounded, in paise.',
  })
  landedUnitCostPaise!: number;

  @ApiProperty({ nullable: true, example: 'WH2410A' })
  batchNo!: string | null;

  @ApiProperty({ nullable: true, example: '2027-09-30' })
  expiryDate!: string | null;
}

export class PurchaseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ example: 'Kothrud shop' })
  branchName!: string;

  @ApiProperty()
  supplierId!: string;

  @ApiProperty({ example: 'Nutri Distributors Pvt Ltd' })
  supplierName!: string;

  @ApiProperty({ example: 'NDP/2410/0417' })
  invoiceRef!: string;

  @ApiProperty({ example: '2026-10-19' })
  invoiceDate!: string;

  @ApiProperty({ example: 150000 })
  otherCostPaise!: number;

  @ApiProperty({
    example: 5997000,
    description: 'Sum of qty x unit price, before the extra costs.',
  })
  subtotalPaise!: number;

  @ApiProperty({
    example: 6147000,
    description: 'Subtotal plus extra costs: what the supplier is owed for this bill.',
  })
  totalPaise!: number;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ nullable: true, example: 'Ravi Mehta' })
  createdByName!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [PurchaseLineDetailDto] })
  lines!: PurchaseLineDetailDto[];
}

export class PurchaseSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'NDP/2410/0417' })
  invoiceRef!: string;

  @ApiProperty({ example: '2026-10-19' })
  invoiceDate!: string;

  @ApiProperty()
  supplierName!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty({ example: 3 })
  lineCount!: number;

  @ApiProperty({ example: 6147000 })
  totalPaise!: number;

  @ApiProperty()
  createdAt!: string;
}

export class PurchaseListDto {
  @ApiProperty({ type: [PurchaseSummaryDto], description: 'Newest first.' })
  items!: PurchaseSummaryDto[];

  @ApiProperty({ example: 40 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class SupplierReturnLineDetailDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ example: 6 })
  qty!: number;

  @ApiProperty({ example: 249900 })
  unitCreditPaise!: number;

  @ApiProperty({ example: 1499400 })
  creditPaise!: number;
}

export class SupplierReturnDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'DN-0007', description: 'The debit note number, counted per business.' })
  debitNoteNo!: string;

  @ApiProperty()
  supplierId!: string;

  @ApiProperty()
  supplierName!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty({ example: 'Damaged in transit' })
  reason!: string;

  @ApiProperty({ example: 1499400, description: 'The credit the supplier gives, in paise.' })
  creditTotalPaise!: number;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [SupplierReturnLineDetailDto] })
  lines!: SupplierReturnLineDetailDto[];
}

export class SupplierReturnListDto {
  @ApiProperty({ type: [SupplierReturnDto], description: 'Newest first.' })
  items!: SupplierReturnDto[];
}
