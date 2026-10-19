import { ApiProperty } from '@nestjs/swagger';

/**
 * What the catalogue endpoints return. Plain classes, never database rows.
 *
 * COST SECRECY (hard rule 3): `ProductCashierDto` has NO field for cost, margin or anything derived from it, so a
 * cashier-audience response cannot leak one. `ProductAdminDto` adds those fields and is returned ONLY to people who hold
 * `products.cost.read`. They are separate classes on purpose; a test scans every product response for cost-like keys.
 */

export class ProductCashierDto {
  @ApiProperty({ example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'Gold Standard 100% Whey' })
  name!: string;

  @ApiProperty({ example: 'Optimum Nutrition', description: 'Empty when there is no brand.' })
  brand!: string;

  @ApiProperty({
    example: '2 kg / Double Rich Chocolate',
    description: 'Empty when there is no variant.',
  })
  variant!: string;

  @ApiProperty({ nullable: true })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, example: 'Protein & whey' })
  categoryName!: string | null;

  @ApiProperty({ nullable: true, example: 'ON-GS-2KG-CHOC' })
  sku!: string | null;

  @ApiProperty({ nullable: true, example: '748927052145' })
  barcode!: string | null;

  @ApiProperty({ nullable: true, example: '21069099' })
  hsn!: string | null;

  @ApiProperty({
    nullable: true,
    example: 1800,
    description: 'GST rate in basis points (1800 = 18%).',
  })
  gstRateBp!: number | null;

  @ApiProperty({ example: 349900, description: 'MRP in force now, in paise.' })
  mrpPaise!: number;

  @ApiProperty({ example: 299900, description: 'Selling price in force now, in paise.' })
  pricePaise!: number;

  @ApiProperty({
    description: 'True when an image is saved. Fetch it from GET /v1/products/{id}/image.',
    example: true,
  })
  hasImage!: boolean;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

/** Returned only to people with products.cost.read. */
export class ProductAdminDto extends ProductCashierDto {
  @ApiProperty({
    nullable: true,
    example: 249900,
    description: 'CONFIDENTIAL. What the item costs you, in paise, as entered by hand.',
  })
  purchaseCostPaise!: number | null;

  @ApiProperty({
    nullable: true,
    example: 1667,
    description:
      'CONFIDENTIAL. Margin of the selling price over the cost, in basis points of the price (2500 = 25%).',
  })
  marginBp!: number | null;

  @ApiProperty({
    description: 'CONFIDENTIAL. True when the selling price is below the cost.',
    example: false,
  })
  belowCost!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class ProductListDto {
  @ApiProperty({
    description:
      'ProductAdminDto items for callers with products.cost.read, ProductCashierDto items for everyone else.',
    type: [ProductCashierDto],
  })
  items!: ProductCashierDto[] | ProductAdminDto[];

  @ApiProperty({
    description: 'How many products match the filters, across all pages.',
    example: 128,
  })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class PriceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 349900 })
  mrpPaise!: number;

  @ApiProperty({ example: 299900 })
  pricePaise!: number;

  @ApiProperty({ description: 'When this price starts to apply.' })
  effectiveFrom!: string;

  @ApiProperty({ example: 'Diwali offer' })
  reason!: string;

  @ApiProperty({ nullable: true, example: 'Ravi Mehta', description: 'Who changed it.' })
  changedByName!: string | null;

  @ApiProperty({ description: 'True for the price in force now.' })
  current!: boolean;

  @ApiProperty({ description: 'True when it has not started yet (a scheduled change).' })
  scheduled!: boolean;
}

export class PriceHistoryDto {
  @ApiProperty({ type: [PriceDto], description: 'Newest first.' })
  prices!: PriceDto[];
}

export class CategoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Protein & whey' })
  name!: string;

  @ApiProperty({ nullable: true, example: '21069099' })
  defaultHsn!: string | null;

  @ApiProperty({ nullable: true, example: 1800 })
  defaultGstRateBp!: number | null;
}

export class ProductOptionsDto {
  @ApiProperty({ type: [CategoryDto] })
  categories!: CategoryDto[];

  @ApiProperty({
    type: [Number],
    example: [0, 500, 1800, 4000],
    description: 'The GST rates a product may carry, in basis points.',
  })
  gstRatesBp!: number[];

  @ApiProperty({
    description: 'True when the business has a GSTIN, so HSN and GST rate are required.',
    example: true,
  })
  taxDetailsRequired!: boolean;
}

export class ImportRowProblemDto {
  @ApiProperty({
    example: 7,
    description: 'Row number as a spreadsheet shows it (the header is row 1).',
  })
  rowNumber!: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: { field: { type: 'string' }, message: { type: 'string' } },
    },
    example: [{ field: 'barcode', message: 'Another product already has this barcode.' }],
  })
  errors!: Array<{ field: string; message: string }>;
}

export class ImportReportDto {
  @ApiProperty({ description: 'True when nothing was saved (a check only).' })
  dryRun!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Problems with the file as a whole. When present, no row was read.',
  })
  fileErrors!: string[];

  @ApiProperty({ type: [String], description: 'Columns in the file that are not used.' })
  ignoredColumns!: string[];

  @ApiProperty({ example: 120, description: 'Product rows in the file.' })
  totalRows!: number;

  @ApiProperty({
    example: 118,
    description: 'Products created (or that would be created, for a check).',
  })
  createdCount!: number;

  @ApiProperty({ example: 2 })
  failedCount!: number;

  @ApiProperty({ type: [String], description: 'Categories made because the file named them.' })
  categoriesCreated!: string[];

  @ApiProperty({
    type: [ImportRowProblemDto],
    description: 'Only the rows that failed, in file order.',
  })
  failedRows!: ImportRowProblemDto[];
}
