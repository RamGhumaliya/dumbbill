import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { DomainError } from '../../common/errors/domain-error';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { ClientInfo } from '../auth/http/decorators';
import { LoadedAccess } from '../permissions/access.service';
import { Permission } from '../permissions/permission.decorators';
import { CategoriesService } from './categories.service';
import {
  ChangePriceDto,
  CreateCategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/catalogue-requests.dto';
import {
  CategoryDto,
  ImportReportDto,
  PriceHistoryDto,
  ProductAdminDto,
  ProductCashierDto,
  ProductListDto,
  ProductOptionsDto,
} from './dto/catalogue-responses.dto';
import { ProductImportService } from './import.service';
import { PRODUCT_IMAGE_MAX_BYTES } from './images/product-images';
import { ProductsService } from './products.service';

/** The signed-in person's access, loaded by the permissions guard before any of these methods run. */
function accessOf(request: Request): LoadedAccess {
  if (!request.access) throw new Error('Permissions guard did not run for a catalogue route.');
  return request.access;
}

/** Largest CSV accepted (2 MB is room for the 2000-row limit with long names). */
const CSV_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Documents a success answer that is a product in one of its two shapes: `ProductAdminDto` for people with
 * `products.cost.read` and `ProductCashierDto` (no cost fields at all) for everyone else.
 */
function ApiProductResponse(status: 200 | 201, description: string) {
  const schema = {
    oneOf: [{ $ref: getSchemaPath(ProductAdminDto) }, { $ref: getSchemaPath(ProductCashierDto) }],
  };
  return applyDecorators(
    ApiExtraModels(ProductAdminDto, ProductCashierDto),
    status === 201
      ? ApiCreatedResponse({ description, schema })
      : ApiOkResponse({ description, schema }),
  );
}

const COST_NOTE =
  'The answer has no cost, margin or profit fields unless you hold products.cost.read.';

/**
 * The catalogue: products with variants, barcodes, HSN and GST, prices with history, pictures, and CSV import.
 *
 * Reading needs `products.read` (cashiers have it). Changing details needs `products.write`; changing or setting a price
 * needs `pricing.write`. Cost is confidential: it appears only for people with `products.cost.read`.
 */
@ApiTags('Products')
@ApiBearerAuth('staff-bearer')
@Controller('v1/products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly imports: ProductImportService,
    private readonly categories: CategoriesService,
  ) {}

  @Get('options')
  @Permission('products.read')
  @ApiOperation({
    operationId: 'getProductOptions',
    summary: 'Categories and GST rates for the product form',
    description:
      'Your categories, the GST rates a product may carry (basis points), and whether HSN and GST rate are required (they are when your business has a GSTIN).\n\nPermission: products.read',
  })
  @ApiOkResponse({ type: ProductOptionsDto, description: 'Options for the product form.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getProductOptions(): Promise<ProductOptionsDto> {
    return this.products.options();
  }

  @Get()
  @Permission('products.read')
  @ApiOperation({
    operationId: 'listProducts',
    summary: 'List and search products',
    description: `A page of products with the price in force now. Search looks in name, brand, variant, SKU and barcode. ${COST_NOTE}\n\nPermission: products.read`,
  })
  @ApiOkResponse({
    type: ProductListDto,
    description:
      'The products. Items are ProductAdminDto for callers with products.cost.read, otherwise ProductCashierDto.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'limit', message: 'limit must not be greater than 200' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  listProducts(
    @Req() request: Request,
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductListDto> {
    return this.products.list(accessOf(request), query);
  }

  @Get('by-barcode/:barcode')
  @Permission('products.read')
  @ApiOperation({
    operationId: 'getProductByBarcode',
    summary: 'Find an active product by its barcode',
    description: `Used by the till when a barcode is scanned. ${COST_NOTE}\n\nPermission: products.read`,
  })
  @ApiProductResponse(200, 'The product.')
  @ApiProblemResponse('NOT_FOUND', { detail: 'No product has this barcode.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getProductByBarcode(
    @Req() request: Request,
    @Param('barcode') barcode: string,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.products.byBarcode(accessOf(request), barcode);
  }

  @Post()
  @Permission('products.write', 'pricing.write')
  @ApiOperation({
    operationId: 'createProduct',
    summary: 'Create a product',
    description: `Creates a product with its first price. HSN and GST rate are required when your business has a GSTIN. A barcode, a SKU, and the combination of name, brand and variant must each be unique. A cost may be sent only with products.cost.read. ${COST_NOTE}\n\nPermission: products.write, pricing.write`,
  })
  @ApiProductResponse(201, 'The new product.')
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'hsn', message: 'HSN is required because your business has a GSTIN.' }],
  })
  @ApiProblemResponse('CONFLICT', {
    detail: 'This product clashes with an existing one.',
    errors: [{ field: 'barcode', message: 'Another product already has this barcode.' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', {
    detail: 'You do not have permission to set the purchase cost.',
  })
  @ApiProblemResponse('INTERNAL_ERROR')
  createProduct(
    @Req() request: Request,
    @Body() dto: CreateProductDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.products.create(accessOf(request), dto, info);
  }

  @Post('import')
  @HttpCode(200)
  @Permission('products.write', 'pricing.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'dryRun',
    required: false,
    type: Boolean,
    description: 'true = check the file and report, save nothing.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV with a header row. Columns: name, brand, category, variant, sku, barcode, hsn, gst_percent, mrp, price, cost. Amounts in rupees. Up to 2000 rows and 2 MB.',
        },
      },
    },
  })
  @ApiOperation({
    operationId: 'importProducts',
    summary: 'Import products from a CSV file',
    description:
      'Checks every row and creates the valid ones; the report lists each failed row with the exact problems, so you can fix just those and import again. Categories named in the file are matched ignoring case and created when missing. A cost column needs products.cost.read. Use dryRun=true to check without saving.\n\nPermission: products.write, pricing.write',
  })
  @ApiOkResponse({
    type: ImportReportDto,
    description: 'What was (or would be) created, and every failed row.',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'file', message: 'Choose a CSV file.' }],
  })
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  importProducts(
    @Req() request: Request,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @ClientInfo() info: RequestInfo,
  ): Promise<ImportReportDto> {
    if (!file) {
      throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', [
        { field: 'file', message: 'Choose a CSV file.' },
      ]);
    }
    return this.imports.importCsv(
      accessOf(request),
      file.buffer.toString('utf8'),
      dryRun === 'true',
      info,
    );
  }

  @Get(':productId')
  @Permission('products.read')
  @ApiOperation({
    operationId: 'getProduct',
    summary: 'Get a product',
    description: `One product with the price in force now. ${COST_NOTE}\n\nPermission: products.read`,
  })
  @ApiProductResponse(200, 'The product.')
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getProduct(
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.products.get(accessOf(request), productId);
  }

  @Put(':productId')
  @Permission('products.write')
  @ApiOperation({
    operationId: 'updateProduct',
    summary: 'Change a product',
    description: `Replaces the descriptive fields. Prices change through the price endpoint so each change is recorded. A cost may be sent only with products.cost.read; leave it out to keep the current one. ${COST_NOTE}\n\nPermission: products.write`,
  })
  @ApiProductResponse(200, 'The saved product.')
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'hsn', message: 'An HSN code has 4, 6 or 8 digits.' }],
  })
  @ApiProblemResponse('CONFLICT', {
    detail: 'This product clashes with an existing one.',
    errors: [{ field: 'sku', message: 'Another product already has this SKU.' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  updateProduct(
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.products.update(accessOf(request), productId, dto, info);
  }

  @Post(':productId/deactivate')
  @HttpCode(200)
  @Permission('products.write')
  @ApiOperation({
    operationId: 'deactivateProduct',
    summary: 'Switch a product off',
    description:
      'The product stops appearing in the till and in the default list. History is kept; products are never deleted. Safe to repeat.\n\nPermission: products.write',
  })
  @ApiProductResponse(200, 'The product, now switched off.')
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  deactivateProduct(
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.products.setActive(accessOf(request), productId, false, info);
  }

  @Post(':productId/activate')
  @HttpCode(200)
  @Permission('products.write')
  @ApiOperation({
    operationId: 'activateProduct',
    summary: 'Switch a product back on',
    description: 'Safe to repeat.\n\nPermission: products.write',
  })
  @ApiProductResponse(200, 'The product, now active.')
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  activateProduct(
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.products.setActive(accessOf(request), productId, true, info);
  }

  @Get(':productId/prices')
  @ApiTags('Pricing')
  @Permission('products.write')
  @ApiOperation({
    operationId: 'getPriceHistory',
    summary: 'Price history of a product',
    description:
      'Every price the product ever had, newest first, with who changed it and why. Scheduled (future) prices are marked.\n\nPermission: products.write',
  })
  @ApiOkResponse({ type: PriceHistoryDto, description: 'The price history.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getPriceHistory(@Param('productId', ParseUUIDPipe) productId: string): Promise<PriceHistoryDto> {
    return this.products.priceHistory(productId);
  }

  @Post(':productId/prices')
  @ApiTags('Pricing')
  @HttpCode(200)
  @Permission('pricing.write')
  @ApiOperation({
    operationId: 'changePrice',
    summary: 'Change a price',
    description: `Adds a row to the append-only price history (who, when, why); old rows are never edited. The selling price may not exceed the MRP. A new price starts now or at a later time you give; it cannot start in the past. ${COST_NOTE}\n\nPermission: pricing.write`,
  })
  @ApiProductResponse(
    200,
    'The product with its new price (or the unchanged price when the change is scheduled).',
  )
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'pricePaise', message: 'The selling price cannot be higher than the MRP.' }],
  })
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', { detail: 'The product already has this price.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  changePrice(
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ChangePriceDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    return this.products.changePrice(accessOf(request), productId, dto, info);
  }

  @Put(':productId/image')
  @Permission('products.write')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'JPEG, PNG or WebP, up to 2 MB.' },
      },
    },
  })
  @ApiOperation({
    operationId: 'uploadProductImage',
    summary: "Upload a product's picture",
    description:
      'Replaces the picture. The upload is decoded and saved again as two clean WebP files (800 px and 160 px), so nothing else it carried is kept.\n\nPermission: products.write',
  })
  @ApiProductResponse(200, 'The product, now with a picture.')
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'file', message: 'Choose an image file.' }],
  })
  @ApiProblemResponse('FILE_TYPE_NOT_ALLOWED')
  @ApiProblemResponse('FILE_CONTENT_MISMATCH')
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  uploadProductImage(
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @ClientInfo() info: RequestInfo,
  ): Promise<ProductCashierDto | ProductAdminDto> {
    if (!file) {
      throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', [
        { field: 'file', message: 'Choose an image file.' },
      ]);
    }
    return this.products.setImage(accessOf(request), productId, file.buffer, info);
  }

  @Get(':productId/image')
  @Permission('products.read')
  @ApiProduces('image/webp')
  @ApiQuery({
    name: 'size',
    required: false,
    enum: ['full', 'thumb'],
    description: 'Default full.',
  })
  @ApiOperation({
    operationId: 'getProductImage',
    summary: "Download a product's picture",
    description:
      'The picture, as WebP. Needs the bearer token, so apps fetch it and show it from memory rather than with a plain image link.\n\nPermission: products.read',
  })
  @ApiOkResponse({
    description: 'The image.',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product has no picture.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async getProductImage(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('size') size: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const opened = await this.products.openImage(productId, size === 'thumb' ? 'thumb' : 'full');
    response.set({
      'Content-Type': 'image/webp',
      'Content-Length': String(opened.size),
      // Private data behind a login: never stored by shared caches. `no-cache` makes browsers re-check after a change.
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    return opened.file;
  }

  @Delete(':productId/image')
  @HttpCode(204)
  @Permission('products.write')
  @ApiOperation({
    operationId: 'removeProductImage',
    summary: "Remove a product's picture",
    description: 'Deletes the picture. Safe to repeat.\n\nPermission: products.write',
  })
  @ApiNoContentResponse({ description: 'The picture is gone.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async removeProductImage(
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.products.removeImage(accessOf(request), productId, info);
  }

  @Post('categories')
  @Permission('products.write')
  @ApiOperation({
    operationId: 'createCategory',
    summary: 'Add a category',
    description:
      'Adds a product category. Its default HSN and GST rate are suggestions that pre-fill the product form.\n\nPermission: products.write',
  })
  @ApiCreatedResponse({ type: CategoryDto, description: 'The new category.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'defaultGstRateBp', message: 'Choose a GST rate from the list.' }],
  })
  @ApiProblemResponse('CONFLICT', {
    detail: 'A category with this name already exists.',
    errors: [{ field: 'name', message: 'A category with this name already exists.' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  createCategory(
    @Req() request: Request,
    @Body() dto: CreateCategoryDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<CategoryDto> {
    return this.categories.create(accessOf(request), dto, info);
  }
}
