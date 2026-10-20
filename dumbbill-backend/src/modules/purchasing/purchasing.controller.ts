import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { ClientInfo } from '../auth/http/decorators';
import { LoadedAccess } from '../permissions/access.service';
import { Permission } from '../permissions/permission.decorators';
import {
  CreatePurchaseDto,
  CreateSupplierReturnDto,
  ListPurchasesQueryDto,
  ListSuppliersQueryDto,
  SupplierDetailsDto,
} from './dto/purchasing-requests.dto';
import {
  PurchaseDto,
  PurchaseListDto,
  SupplierDto,
  SupplierListDto,
  SupplierReturnDto,
  SupplierReturnListDto,
} from './dto/purchasing-responses.dto';
import { PurchasesService } from './purchases.service';
import { SupplierReturnsService } from './supplier-returns.service';
import { SuppliersService } from './suppliers.service';

/** The signed-in person's access, loaded by the permissions guard before any of these methods run. */
function accessOf(request: Request): LoadedAccess {
  if (!request.access) throw new Error('Permissions guard did not run for a purchasing route.');
  return request.access;
}

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'A random key made once per form (a UUID is ideal). Resend the SAME key when retrying: the server then returns the saved answer instead of doing the work twice. A new form needs a new key.',
  example: '7f9c2a40-3c7e-4b52-9a39-0b1d1f6e2c11',
};

/** Tell the app a retry was recognised: the answer is the saved one from the first attempt. */
function markReplay(response: Response, replayed: boolean): void {
  if (replayed) response.set('Idempotent-Replayed', 'true');
}

/**
 * Suppliers. Everything here needs `purchases.write`: supplier details, bills and balances are cost information that
 * cashiers never see.
 */
@ApiTags('Suppliers')
@ApiBearerAuth('staff-bearer')
@Controller('v1/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'listSuppliers',
    summary: 'List suppliers',
    description:
      'Suppliers with what the shop owes each (their bills minus debit-note credit; payments are not recorded yet). Search looks in name, GSTIN and phone.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: SupplierListDto, description: 'The suppliers, by name.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'status', message: 'status must be one of: active, inactive, all' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  listSuppliers(@Query() query: ListSuppliersQueryDto): Promise<SupplierListDto> {
    return this.suppliers.list(query);
  }

  @Post()
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'createSupplier',
    summary: 'Add a supplier',
    description:
      'The name must be new (ignoring case). A GSTIN is optional; if given, its check character is verified.\n\nPermission: purchases.write',
  })
  @ApiCreatedResponse({ type: SupplierDto, description: 'The new supplier.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'gstin', message: 'A GSTIN has 15 characters, like 27AAPFU0939F1ZV.' }],
  })
  @ApiProblemResponse('CONFLICT', {
    detail: 'A supplier with this name already exists.',
    errors: [{ field: 'name', message: 'A supplier with this name already exists.' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  createSupplier(
    @Req() request: Request,
    @Body() dto: SupplierDetailsDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<SupplierDto> {
    return this.suppliers.create(accessOf(request), dto, info);
  }

  @Get(':supplierId')
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'getSupplier',
    summary: 'Get a supplier',
    description: 'One supplier with what the shop owes them.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: SupplierDto, description: 'The supplier.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This supplier does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getSupplier(@Param('supplierId', ParseUUIDPipe) supplierId: string): Promise<SupplierDto> {
    return this.suppliers.get(supplierId);
  }

  @Put(':supplierId')
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'updateSupplier',
    summary: 'Change a supplier',
    description: "Replaces the supplier's details.\n\nPermission: purchases.write",
  })
  @ApiOkResponse({ type: SupplierDto, description: 'The saved supplier.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'phone', message: 'phone must be 8 to 14 digits, with an optional +' }],
  })
  @ApiProblemResponse('CONFLICT', {
    detail: 'A supplier with this name already exists.',
    errors: [{ field: 'name', message: 'A supplier with this name already exists.' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This supplier does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  updateSupplier(
    @Req() request: Request,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() dto: SupplierDetailsDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<SupplierDto> {
    return this.suppliers.update(accessOf(request), supplierId, dto, info);
  }

  @Post(':supplierId/deactivate')
  @HttpCode(200)
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'deactivateSupplier',
    summary: 'Switch a supplier off',
    description:
      'New purchases cannot be recorded for a switched-off supplier. History is kept. Safe to repeat.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: SupplierDto, description: 'The supplier, now switched off.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This supplier does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  deactivateSupplier(
    @Req() request: Request,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<SupplierDto> {
    return this.suppliers.setActive(accessOf(request), supplierId, false, info);
  }

  @Post(':supplierId/activate')
  @HttpCode(200)
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'activateSupplier',
    summary: 'Switch a supplier back on',
    description: 'Safe to repeat.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: SupplierDto, description: 'The supplier, now active.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This supplier does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  activateSupplier(
    @Req() request: Request,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<SupplierDto> {
    return this.suppliers.setActive(accessOf(request), supplierId, true, info);
  }
}

/**
 * Purchases: recording a supplier's bill. Needs `purchases.write`. A saved purchase is never edited; corrections are
 * supplier returns or stock adjustments.
 */
@ApiTags('Purchases')
@ApiBearerAuth('staff-bearer')
@Controller('v1/purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post()
  @Permission('purchases.write')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    operationId: 'createPurchase',
    summary: 'Record a purchase',
    description:
      "Enters a supplier's bill: the goods go into stock at their landed cost (price plus a share of the extra costs, spread in proportion to line value), the weighted average cost is updated, batches are created for expiry, and the supplier is owed the total. Everything happens in one step or not at all. The supplier's invoice number cannot be entered twice; an expiry date cannot be in the past. Needs an Idempotency-Key header: a retry returns the saved purchase.\n\nPermission: purchases.write",
  })
  @ApiCreatedResponse({
    type: PurchaseDto,
    description:
      'The saved purchase (a retry with the same key returns the same answer, with the header `Idempotent-Replayed: true`).',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'lines[0].expiryDate', message: 'This batch has already expired.' }],
  })
  @ApiProblemResponse('BAD_REQUEST', {
    detail:
      'Send an Idempotency-Key header of 8 to 100 letters, digits, dashes or underscores (a UUID is ideal).',
  })
  @ApiProblemResponse('CONFLICT', {
    detail: "This supplier's invoice number is already entered.",
    errors: [
      { field: 'invoiceRef', message: "This supplier's invoice number is already entered." },
    ],
  })
  @ApiProblemResponse('IDEMPOTENCY_KEY_REUSED')
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', {
    detail: 'A single bill cannot come to more than Rs 2,00,00,000.',
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This supplier does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  async createPurchase(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreatePurchaseDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<PurchaseDto> {
    const result = await this.purchases.create(accessOf(request), dto, idempotencyKey, info);
    markReplay(response, result.replayed);
    response.status(result.status);
    return result.body;
  }

  @Get()
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'listPurchases',
    summary: 'List purchases',
    description:
      'Newest first. Only branches the caller may use. Filtering by a branch the caller may not use is refused (403); a branch id that does not belong to this business is 404.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: PurchaseListDto, description: 'A page of purchases.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'limit', message: 'limit must not be greater than 200' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  listPurchases(
    @Req() request: Request,
    @Query() query: ListPurchasesQueryDto,
  ): Promise<PurchaseListDto> {
    return this.purchases.list(accessOf(request), query);
  }

  @Get(':purchaseId')
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'getPurchase',
    summary: 'Get a purchase',
    description:
      'One purchase with its lines, landed costs and batches.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: PurchaseDto, description: 'The purchase.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This purchase does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getPurchase(
    @Req() request: Request,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
  ): Promise<PurchaseDto> {
    return this.purchases.get(accessOf(request), purchaseId);
  }
}

/** Supplier returns (debit notes): goods back to a supplier. Needs `purchases.write`. */
@ApiTags('Purchases')
@ApiBearerAuth('staff-bearer')
@Controller('v1/supplier-returns')
export class SupplierReturnsController {
  constructor(private readonly returns: SupplierReturnsService) {}

  @Post()
  @Permission('purchases.write')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    operationId: 'createSupplierReturn',
    summary: 'Send goods back to a supplier',
    description:
      'Takes the units out of stock at their average cost (from the named batch, or the batches that expire first), records the credit the supplier gives, and numbers a debit note (DN-0001, ...). Fails with INSUFFICIENT_STOCK, saving nothing, if a line asks for more than is on hand. Needs an Idempotency-Key header.\n\nPermission: purchases.write',
  })
  @ApiCreatedResponse({ type: SupplierReturnDto, description: 'The debit note.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'lines[0].productId', message: 'This product does not exist.' }],
  })
  @ApiProblemResponse('BAD_REQUEST', {
    detail:
      'Send an Idempotency-Key header of 8 to 100 letters, digits, dashes or underscores (a UUID is ideal).',
  })
  @ApiProblemResponse('IDEMPOTENCY_KEY_REUSED')
  @ApiProblemResponse('INSUFFICIENT_STOCK', { detail: 'Only 2 in stock, but 6 are needed.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This supplier does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  async createSupplierReturn(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateSupplierReturnDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<SupplierReturnDto> {
    const result = await this.returns.create(accessOf(request), dto, idempotencyKey, info);
    markReplay(response, result.replayed);
    response.status(result.status);
    return result.body;
  }

  @Get()
  @Permission('purchases.write')
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiOperation({
    operationId: 'listSupplierReturns',
    summary: 'List debit notes',
    description:
      'Newest first, up to 200. Only branches the caller may use.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: SupplierReturnListDto, description: 'The debit notes.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  listSupplierReturns(
    @Req() request: Request,
    @Query('supplierId') supplierId?: string,
  ): Promise<SupplierReturnListDto> {
    return this.returns.list(accessOf(request), supplierId);
  }

  @Get(':returnId')
  @Permission('purchases.write')
  @ApiOperation({
    operationId: 'getSupplierReturn',
    summary: 'Get a debit note',
    description: 'One debit note with its lines.\n\nPermission: purchases.write',
  })
  @ApiOkResponse({ type: SupplierReturnDto, description: 'The debit note.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This debit note does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getSupplierReturn(
    @Req() request: Request,
    @Param('returnId', ParseUUIDPipe) returnId: string,
  ): Promise<SupplierReturnDto> {
    return this.returns.get(accessOf(request), returnId);
  }
}
