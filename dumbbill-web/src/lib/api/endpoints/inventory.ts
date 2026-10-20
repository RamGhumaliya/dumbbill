import type { ApiClient } from '../client';
import {
  alertsSchema,
  auditListSchema,
  auditVerifySchema,
  ledgerListSchema,
  purchaseListSchema,
  purchaseSchema,
  stockChangeSchema,
  stockListSchema,
  stockSettingsSchema,
  supplierListSchema,
  supplierReturnListSchema,
  supplierReturnSchema,
  supplierSchema,
  thresholdSchema,
  transferListSchema,
  transferSchema,
  verifySchema,
  type AdjustmentReason,
  type Alerts,
  type AuditVerify,
  type CreatePurchaseInput,
  type CreateSupplierReturnInput,
  type LedgerType,
  type Purchase,
  type Supplier,
  type SupplierInput,
  type SupplierReturn,
  type StockChange,
  type Transfer,
} from '../schemas/inventory';

/**
 * Supplier, purchase, stock and audit endpoints: one function per endpoint, named exactly like the operationId in the
 * Swagger manual. Everything that changes stock or money-like records takes an `idempotencyKey`: make ONE key per form
 * (a fresh form gets a fresh key) and resend the SAME key if the person retries, so a double tap or a lost connection never
 * changes the stock twice (hard rule 6).
 */

// --- Suppliers ---------------------------------------------------------------------------------

/** operationId listSuppliers. Permission: purchases.write. */
export async function listSuppliers(
  client: ApiClient,
  query: { q?: string; status?: 'active' | 'inactive' | 'all' } = {},
): Promise<Supplier[]> {
  const result = await client.request({
    path: '/v1/suppliers',
    query: { ...query },
    schema: supplierListSchema,
  });
  return result.suppliers;
}

/** operationId createSupplier. Permission: purchases.write. */
export function createSupplier(client: ApiClient, body: SupplierInput): Promise<Supplier> {
  return client.request({ method: 'POST', path: '/v1/suppliers', body, schema: supplierSchema });
}

/** operationId updateSupplier. Permission: purchases.write. Replaces all details. */
export function updateSupplier(
  client: ApiClient,
  supplierId: string,
  body: SupplierInput,
): Promise<Supplier> {
  return client.request({
    method: 'PUT',
    path: `/v1/suppliers/${supplierId}`,
    body,
    schema: supplierSchema,
  });
}

/** operationId deactivateSupplier. Permission: purchases.write. */
export function deactivateSupplier(client: ApiClient, supplierId: string): Promise<Supplier> {
  return client.request({
    method: 'POST',
    path: `/v1/suppliers/${supplierId}/deactivate`,
    schema: supplierSchema,
  });
}

/** operationId activateSupplier. Permission: purchases.write. */
export function activateSupplier(client: ApiClient, supplierId: string): Promise<Supplier> {
  return client.request({
    method: 'POST',
    path: `/v1/suppliers/${supplierId}/activate`,
    schema: supplierSchema,
  });
}

// --- Purchases ---------------------------------------------------------------------------------

/** operationId createPurchase. Permission: purchases.write. Needs an Idempotency-Key. */
export function createPurchase(
  client: ApiClient,
  body: CreatePurchaseInput,
  idempotencyKey: string,
): Promise<Purchase> {
  return client.request({
    method: 'POST',
    path: '/v1/purchases',
    body,
    idempotencyKey,
    schema: purchaseSchema,
  });
}

/** operationId listPurchases. Permission: purchases.write. */
export function listPurchases(
  client: ApiClient,
  query: { supplierId?: string; branchId?: string; limit?: number; offset?: number } = {},
) {
  return client.request({ path: '/v1/purchases', query: { ...query }, schema: purchaseListSchema });
}

/** operationId getPurchase. Permission: purchases.write. */
export function getPurchase(client: ApiClient, purchaseId: string): Promise<Purchase> {
  return client.request({ path: `/v1/purchases/${purchaseId}`, schema: purchaseSchema });
}

// --- Supplier returns --------------------------------------------------------------------------

/** operationId createSupplierReturn. Permission: purchases.write. Needs an Idempotency-Key. */
export function createSupplierReturn(
  client: ApiClient,
  body: CreateSupplierReturnInput,
  idempotencyKey: string,
): Promise<SupplierReturn> {
  return client.request({
    method: 'POST',
    path: '/v1/supplier-returns',
    body,
    idempotencyKey,
    schema: supplierReturnSchema,
  });
}

/** operationId listSupplierReturns. Permission: purchases.write. */
export async function listSupplierReturns(client: ApiClient): Promise<SupplierReturn[]> {
  const result = await client.request({
    path: '/v1/supplier-returns',
    schema: supplierReturnListSchema,
  });
  return result.items;
}

// --- Stock -------------------------------------------------------------------------------------

/** operationId listStock. Permission: products.read. Cost fields only for people with products.cost.read. */
export function listStock(
  client: ApiClient,
  query: { branchId: string; q?: string; lowOnly?: boolean; limit?: number; offset?: number },
) {
  return client.request({ path: '/v1/stock', query: { ...query }, schema: stockListSchema });
}

/** operationId listStockLedger. Permission: stock.adjust. Newest first. */
export function listStockLedger(
  client: ApiClient,
  query: {
    branchId: string;
    productId?: string;
    type?: LedgerType;
    limit?: number;
    offset?: number;
  },
) {
  return client.request({
    path: '/v1/stock/ledger',
    query: { ...query },
    schema: ledgerListSchema,
  });
}

/** operationId adjustStock. Permission: stock.adjust. Needs an Idempotency-Key. */
export function adjustStock(
  client: ApiClient,
  body: {
    branchId: string;
    productId: string;
    countedQty: number;
    reason: AdjustmentReason;
    note: string | null;
    batchId?: string;
    unitCostPaise?: number;
  },
  idempotencyKey: string,
): Promise<StockChange> {
  return client.request({
    method: 'POST',
    path: '/v1/stock/adjustments',
    body,
    idempotencyKey,
    schema: stockChangeSchema,
  });
}

/** operationId writeOffExpiredStock. Permission: stock.adjust. Needs an Idempotency-Key. */
export function writeOffExpiredStock(
  client: ApiClient,
  body: { branchId: string; batchId: string; qty?: number; note?: string | null },
  idempotencyKey: string,
): Promise<StockChange> {
  return client.request({
    method: 'POST',
    path: '/v1/stock/write-offs',
    body,
    idempotencyKey,
    schema: stockChangeSchema,
  });
}

/** operationId setLowStockLevel. Permission: stock.adjust. 0 switches the alert off. */
export function setLowStockLevel(
  client: ApiClient,
  body: { branchId: string; productId: string; minQty: number },
) {
  return client.request({
    method: 'PUT',
    path: '/v1/stock/thresholds',
    body,
    schema: thresholdSchema,
  });
}

/** operationId getStockAlerts. Permission: stock.adjust. */
export function getStockAlerts(client: ApiClient, branchId?: string): Promise<Alerts> {
  return client.request({
    path: '/v1/stock/alerts',
    query: { branchId },
    schema: alertsSchema,
  });
}

/** operationId getStockSettings. Permission: settings.manage. */
export function getStockSettings(client: ApiClient) {
  return client.request({ path: '/v1/stock/settings', schema: stockSettingsSchema });
}

/** operationId updateStockSettings. Permission: settings.manage. */
export function updateStockSettings(client: ApiClient, nearExpiryDays: number) {
  return client.request({
    method: 'PUT',
    path: '/v1/stock/settings',
    body: { nearExpiryDays },
    schema: stockSettingsSchema,
  });
}

/** operationId verifyStock. Permission: stock.adjust. Checks the levels against the ledger; changes nothing. */
export function verifyStock(client: ApiClient) {
  return client.request({ path: '/v1/stock/verify', schema: verifySchema });
}

// --- Transfers ---------------------------------------------------------------------------------

/** operationId createTransfer. Permission: stock.transfer. Needs an Idempotency-Key. */
export function createTransfer(
  client: ApiClient,
  body: {
    fromBranchId: string;
    toBranchId: string;
    note: string | null;
    lines: Array<{ productId: string; qty: number }>;
  },
  idempotencyKey: string,
): Promise<Transfer> {
  return client.request({
    method: 'POST',
    path: '/v1/stock/transfers',
    body,
    idempotencyKey,
    schema: transferSchema,
  });
}

/** operationId listTransfers. Permission: stock.transfer. */
export async function listTransfers(
  client: ApiClient,
  status?: 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED',
): Promise<Transfer[]> {
  const result = await client.request({
    path: '/v1/stock/transfers',
    query: { status },
    schema: transferListSchema,
  });
  return result.items;
}

/** operationId receiveTransfer. Permission: stock.transfer (at the receiving branch). */
export function receiveTransfer(client: ApiClient, transferId: string): Promise<Transfer> {
  return client.request({
    method: 'POST',
    path: `/v1/stock/transfers/${transferId}/receive`,
    schema: transferSchema,
  });
}

/** operationId cancelTransfer. Permission: stock.transfer (at the sending branch). */
export function cancelTransfer(client: ApiClient, transferId: string): Promise<Transfer> {
  return client.request({
    method: 'POST',
    path: `/v1/stock/transfers/${transferId}/cancel`,
    schema: transferSchema,
  });
}

// --- Audit -------------------------------------------------------------------------------------

/** operationId listAuditLog. Permission: audit.read. */
export function listAuditLog(
  client: ApiClient,
  query: {
    action?: string;
    entity?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  return client.request({ path: '/v1/audit', query: { ...query }, schema: auditListSchema });
}

/** operationId verifyAuditLog. Permission: audit.read. */
export function verifyAuditLog(client: ApiClient): Promise<AuditVerify> {
  return client.request({ path: '/v1/audit/verify', schema: auditVerifySchema });
}
