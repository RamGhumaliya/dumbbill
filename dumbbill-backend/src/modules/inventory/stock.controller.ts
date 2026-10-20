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
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { ClientInfo } from '../auth/http/decorators';
import { LoadedAccess } from '../permissions/access.service';
import { Permission } from '../permissions/permission.decorators';
import {
  AdjustStockDto,
  AlertsQueryDto,
  CreateTransferDto,
  LedgerQueryDto,
  ListStockQueryDto,
  ListTransfersQueryDto,
  SetThresholdDto,
  StockSettingsDto,
  WriteOffDto,
} from './dto/inventory-requests.dto';
import {
  AlertsDto,
  LedgerEntryAdminDto,
  LedgerListDto,
  RebuildDto,
  StockChangeDto,
  StockListDto,
  StockRowAdminDto,
  StockSettingsResponseDto,
  ThresholdDto,
  TransferDto,
  TransferListDto,
  VerifyDto,
} from './dto/inventory-responses.dto';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';

/** The signed-in person's access, loaded by the permissions guard before any of these methods run. */
function accessOf(request: Request): LoadedAccess {
  if (!request.access) throw new Error('Permissions guard did not run for a stock route.');
  return request.access;
}

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'A random key made once per form (a UUID is ideal). Resend the SAME key when retrying: the server then returns the saved answer instead of changing the stock twice. A new form needs a new key.',
  example: '7f9c2a40-3c7e-4b52-9a39-0b1d1f6e2c11',
};

const BAD_KEY =
  'Send an Idempotency-Key header of 8 to 100 letters, digits, dashes or underscores (a UUID is ideal).';

/** Tell the app a retry was recognised: the answer is the saved one from the first attempt. */
function markReplay(response: Response, replayed: boolean): void {
  if (replayed) response.set('Idempotent-Replayed', 'true');
}

/**
 * Stock: what each branch holds, the ledger behind it, counts, write-offs, alerts, and the checks that prove the books add up.
 *
 * Quantities need `products.read`. Average cost and value appear only for people with `products.cost.read`. Counts, the
 * ledger and alerts need `stock.adjust`. Branch-bound calls also need the person to be allowed to use that branch.
 */
@ApiTags('Inventory')
@ApiBearerAuth('staff-bearer')
@ApiExtraModels(StockRowAdminDto, LedgerEntryAdminDto)
@Controller('v1/stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @Permission('products.read')
  @ApiOperation({
    operationId: 'listStock',
    summary: 'Stock at a branch',
    description:
      'Every active product with how many the branch holds (0 for never-stocked ones) and its low-stock level. People with products.cost.read also get the average cost and value of each; everyone else gets a response with no cost fields at all.\n\nPermission: products.read',
  })
  @ApiOkResponse({
    type: StockListDto,
    description:
      'A page of stock rows (StockRowAdminDto items for callers with products.cost.read, otherwise StockRowCashierDto).',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'branchId', message: 'branchId must be a UUID' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  listStock(@Req() request: Request, @Query() query: ListStockQueryDto): Promise<StockListDto> {
    return this.stock.levels(accessOf(request), query);
  }

  @Get('ledger')
  @Permission('stock.adjust')
  @ApiOperation({
    operationId: 'listStockLedger',
    summary: 'The stock ledger',
    description:
      'Every movement at a branch, newest first: what moved, how many, why, who did it, and the units on hand after. The cost of each movement is included only for people with products.cost.read.\n\nPermission: stock.adjust',
  })
  @ApiOkResponse({
    type: LedgerListDto,
    description:
      'A page of ledger entries (LedgerEntryAdminDto items for callers with products.cost.read, otherwise LedgerEntryDto).',
  })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [
      { field: 'type', message: 'type must be one of the following values: PURCHASE, SALE' },
    ],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  listStockLedger(@Req() request: Request, @Query() query: LedgerQueryDto): Promise<LedgerListDto> {
    return this.stock.ledger(accessOf(request), query);
  }

  @Post('adjustments')
  @Permission('stock.adjust')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    operationId: 'adjustStock',
    summary: 'Count stock',
    description:
      'Set the stock of a product to what you counted. The difference is recorded in the ledger with your reason (recount, damage, lost, other) and in the audit log with the quantity before and after. A lower count removes units at the average cost; a higher count adds them at the average cost. Needs an Idempotency-Key header.\n\nPermission: stock.adjust',
  })
  @ApiCreatedResponse({ type: StockChangeDto, description: 'The quantity before and after.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [
      {
        field: 'reason',
        message: 'reason must be one of the following values: RECOUNT, DAMAGE, LOST, OTHER',
      },
    ],
  })
  @ApiProblemResponse('BAD_REQUEST', { detail: BAD_KEY })
  @ApiProblemResponse('IDEMPOTENCY_KEY_REUSED')
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', {
    detail: 'The count matches what the books already say. Nothing to change.',
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  async adjustStock(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: AdjustStockDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<StockChangeDto> {
    const result = await this.stock.adjust(accessOf(request), dto, idempotencyKey, info);
    markReplay(response, result.replayed);
    response.status(result.status);
    return result.body;
  }

  @Post('write-offs')
  @Permission('stock.adjust')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    operationId: 'writeOffExpiredStock',
    summary: 'Write off an expired batch',
    description:
      'Removes units of a batch whose expiry date has passed, at the average cost (ledger type EXPIRY_WRITE_OFF). Batches that have not expired are refused; use a count with the reason Damage for those. Needs an Idempotency-Key header.\n\nPermission: stock.adjust',
  })
  @ApiCreatedResponse({ type: StockChangeDto, description: 'The quantity before and after.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'batchId', message: 'batchId must be a UUID' }],
  })
  @ApiProblemResponse('BAD_REQUEST', { detail: BAD_KEY })
  @ApiProblemResponse('IDEMPOTENCY_KEY_REUSED')
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', { detail: 'This batch has not expired.' })
  @ApiProblemResponse('INSUFFICIENT_STOCK', { detail: 'Only 2 in stock, but 5 are needed.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This batch does not exist at this branch.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  async writeOffExpiredStock(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: WriteOffDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<StockChangeDto> {
    const result = await this.stock.writeOff(accessOf(request), dto, idempotencyKey, info);
    markReplay(response, result.replayed);
    response.status(result.status);
    return result.body;
  }

  @Put('thresholds')
  @Permission('stock.adjust')
  @ApiOperation({
    operationId: 'setLowStockLevel',
    summary: 'Set a low-stock level',
    description:
      'The product shows in the low-stock alerts at this branch when its stock is at or below this many units. 0 switches the alert off.\n\nPermission: stock.adjust',
  })
  @ApiOkResponse({ type: ThresholdDto, description: 'The saved level.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'minQty', message: 'minQty must not be less than 0' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This product does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  setLowStockLevel(
    @Req() request: Request,
    @Body() dto: SetThresholdDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<ThresholdDto> {
    return this.stock.setThreshold(accessOf(request), dto, info);
  }

  @Get('alerts')
  @Permission('stock.adjust')
  @ApiOperation({
    operationId: 'getStockAlerts',
    summary: 'Low stock and expiry alerts',
    description:
      'Products at or below their low-stock level, batches that expire within the near-expiry window (default 60 days), and batches already expired that still hold units. Only branches you may use. Asking for a branch you may not use is refused (403); a branch id that does not belong to this business is 404.\n\nPermission: stock.adjust',
  })
  @ApiOkResponse({ type: AlertsDto, description: 'What needs attention.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'branchId', message: 'branchId must be a UUID' }],
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  getStockAlerts(@Req() request: Request, @Query() query: AlertsQueryDto): Promise<AlertsDto> {
    return this.stock.alerts(accessOf(request), query);
  }

  @Get('settings')
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'getStockSettings',
    summary: 'Stock settings',
    description: 'The near-expiry window in days.\n\nPermission: settings.manage',
  })
  @ApiOkResponse({ type: StockSettingsResponseDto, description: 'The settings.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getStockSettings(): Promise<StockSettingsResponseDto> {
    return this.stock.settings();
  }

  @Put('settings')
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'updateStockSettings',
    summary: 'Change the stock settings',
    description:
      'Sets how many days before its expiry date a batch counts as near expiry (1 to 365).\n\nPermission: settings.manage',
  })
  @ApiOkResponse({ type: StockSettingsResponseDto, description: 'The saved settings.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'nearExpiryDays', message: 'nearExpiryDays must not be greater than 365' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  updateStockSettings(
    @Req() request: Request,
    @Body() dto: StockSettingsDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<StockSettingsResponseDto> {
    return this.stock.updateSettings(accessOf(request), dto.nearExpiryDays, info);
  }

  @Get('verify')
  @Permission('stock.adjust')
  @ApiOperation({
    operationId: 'verifyStock',
    summary: 'Check that stock matches the ledger',
    description:
      'For every product at every branch, checks that the stock level equals the sum of its ledger rows (quantity and value) and that the batches add up to the level. Changes nothing.\n\nPermission: stock.adjust',
  })
  @ApiOkResponse({
    type: VerifyDto,
    description: 'ok is true when everything agrees; otherwise the problems are listed.',
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  verifyStock(): Promise<VerifyDto> {
    return this.stock.verify();
  }

  @Post('rebuild')
  @HttpCode(200)
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'rebuildStockLevels',
    summary: 'Put stock levels right from the ledger',
    description:
      'The ledger is the truth and the levels are a projection of it. This corrects any level or batch that disagrees. Does nothing when all agree. Audited.\n\nPermission: settings.manage',
  })
  @ApiOkResponse({ type: RebuildDto, description: 'How many levels and batches were corrected.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  rebuildStockLevels(
    @Req() request: Request,
    @ClientInfo() info: RequestInfo,
  ): Promise<RebuildDto> {
    return this.stock.rebuild(accessOf(request), info);
  }
}

/** Transfers between branches: send, receive, cancel. Needs `stock.transfer` and use of the branch involved. */
@ApiTags('Inventory')
@ApiBearerAuth('staff-bearer')
@Controller('v1/stock/transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @Permission('stock.transfer')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    operationId: 'createTransfer',
    summary: 'Send goods to another branch',
    description:
      'The goods leave the sending branch now (at its average cost, from the batches that expire first) and are in transit until the other branch receives them. Fails with INSUFFICIENT_STOCK, saving nothing, if a line asks for more than is on hand. Needs an Idempotency-Key header.\n\nPermission: stock.transfer',
  })
  @ApiCreatedResponse({ type: TransferDto, description: 'The transfer, in transit.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [
      { field: 'toBranchId', message: 'Choose a different branch from the one the goods leave.' },
    ],
  })
  @ApiProblemResponse('BAD_REQUEST', { detail: BAD_KEY })
  @ApiProblemResponse('IDEMPOTENCY_KEY_REUSED')
  @ApiProblemResponse('INSUFFICIENT_STOCK', { detail: 'Only 2 in stock, but 12 are needed.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'The receiving branch does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  async createTransfer(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateTransferDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<TransferDto> {
    const result = await this.transfers.create(accessOf(request), dto, idempotencyKey, info);
    markReplay(response, result.replayed);
    response.status(result.status);
    return result.body;
  }

  @Get()
  @Permission('stock.transfer')
  @ApiOperation({
    operationId: 'listTransfers',
    summary: 'List transfers',
    description:
      'Newest first, up to 200. Transfers where either branch is one you may use.\n\nPermission: stock.transfer',
  })
  @ApiOkResponse({ type: TransferListDto, description: 'The transfers.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [
      {
        field: 'status',
        message: 'status must be one of the following values: IN_TRANSIT, RECEIVED, CANCELLED',
      },
    ],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  listTransfers(
    @Req() request: Request,
    @Query() query: ListTransfersQueryDto,
  ): Promise<TransferListDto> {
    return this.transfers.list(accessOf(request), query);
  }

  @Get(':transferId')
  @Permission('stock.transfer')
  @ApiOperation({
    operationId: 'getTransfer',
    summary: 'Get a transfer',
    description: 'One transfer with its lines.\n\nPermission: stock.transfer',
  })
  @ApiOkResponse({ type: TransferDto, description: 'The transfer.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This transfer does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getTransfer(
    @Req() request: Request,
    @Param('transferId', ParseUUIDPipe) transferId: string,
  ): Promise<TransferDto> {
    return this.transfers.get(accessOf(request), transferId);
  }

  @Post(':transferId/receive')
  @HttpCode(200)
  @Permission('stock.transfer')
  @ApiOperation({
    operationId: 'receiveTransfer',
    summary: 'Confirm a transfer arrived',
    description:
      'The receiving branch confirms: the goods enter its stock at exactly the value they left with, in the same batches. Only once: a second attempt is told it is already done.\n\nPermission: stock.transfer',
  })
  @ApiOkResponse({ type: TransferDto, description: 'The transfer, now received.' })
  @ApiProblemResponse('CONFLICT', { detail: 'This transfer has already been received.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This transfer does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  receiveTransfer(
    @Req() request: Request,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<TransferDto> {
    return this.transfers.receive(accessOf(request), transferId, info);
  }

  @Post(':transferId/cancel')
  @HttpCode(200)
  @Permission('stock.transfer')
  @ApiOperation({
    operationId: 'cancelTransfer',
    summary: 'Cancel a transfer in transit',
    description:
      'The sending branch takes the goods back before they arrive; they return at the value they left with. Only while in transit.\n\nPermission: stock.transfer',
  })
  @ApiOkResponse({ type: TransferDto, description: 'The transfer, now cancelled.' })
  @ApiProblemResponse('CONFLICT', { detail: 'This transfer has already been received.' })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This transfer does not exist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN', { detail: 'You do not have access to this branch.' })
  @ApiProblemResponse('INTERNAL_ERROR')
  cancelTransfer(
    @Req() request: Request,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @ClientInfo() info: RequestInfo,
  ): Promise<TransferDto> {
    return this.transfers.cancel(accessOf(request), transferId, info);
  }
}
