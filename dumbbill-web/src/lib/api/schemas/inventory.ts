import { z } from 'zod';

/**
 * Shapes of the supplier, purchase, stock and audit endpoints, written from the backend's Swagger manual (tags
 * "Suppliers", "Purchases", "Inventory", "Audit") and `docs/api/purchasing-and-stock.md`. If the backend changes one of
 * these, the checks fail with a clear message here instead of silently breaking a screen.
 *
 * COST SECRECY: stock rows and ledger entries carry cost fields (`wacPaise`, `valuePaise`, `unitCostPaise`, ...) ONLY for
 * people holding `products.cost.read`. They are OPTIONAL here on purpose. A screen shows a cost column only when the person
 * holds that permission (`useCan('products.cost.read')`), never because a field happens to be present.
 */

// --- Suppliers ---------------------------------------------------------------------------------

export const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  /** What the shop owes this supplier in paise: their bills minus debit-note credit (payments are not recorded yet). */
  balancePaise: z.number().int(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const supplierListSchema = z.object({ suppliers: z.array(supplierSchema) });

/** What the supplier form sends. Blank optional text is sent as null. */
export interface SupplierInput {
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  notes: string | null;
}

// --- Purchases ---------------------------------------------------------------------------------

export const purchaseLineSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string(),
  variant: z.string(),
  qty: z.number().int(),
  unitCostPaise: z.number().int(),
  allocatedCostPaise: z.number().int(),
  lineTotalPaise: z.number().int(),
  landedUnitCostPaise: z.number().int(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
});

export const purchaseSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  invoiceRef: z.string(),
  invoiceDate: z.string(),
  otherCostPaise: z.number().int(),
  subtotalPaise: z.number().int(),
  totalPaise: z.number().int(),
  note: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(purchaseLineSchema),
});
export type Purchase = z.infer<typeof purchaseSchema>;

export const purchaseSummarySchema = z.object({
  id: z.string(),
  invoiceRef: z.string(),
  invoiceDate: z.string(),
  supplierName: z.string(),
  branchName: z.string(),
  lineCount: z.number().int(),
  totalPaise: z.number().int(),
  createdAt: z.string(),
});
export type PurchaseSummary = z.infer<typeof purchaseSummarySchema>;

export const purchaseListSchema = z.object({
  items: z.array(purchaseSummarySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export interface PurchaseLineInput {
  productId: string;
  qty: number;
  unitCostPaise: number;
  batchNo: string | null;
  expiryDate: string | null;
}

export interface CreatePurchaseInput {
  supplierId: string;
  branchId: string;
  invoiceRef: string;
  /** YYYY-MM-DD. */
  invoiceDate: string;
  otherCostPaise: number;
  note: string | null;
  lines: PurchaseLineInput[];
}

// --- Supplier returns (debit notes) -------------------------------------------------------------

export const supplierReturnSchema = z.object({
  id: z.string(),
  debitNoteNo: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  reason: z.string(),
  creditTotalPaise: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      qty: z.number().int(),
      unitCreditPaise: z.number().int(),
      creditPaise: z.number().int(),
    }),
  ),
});
export type SupplierReturn = z.infer<typeof supplierReturnSchema>;

export const supplierReturnListSchema = z.object({ items: z.array(supplierReturnSchema) });

export interface CreateSupplierReturnInput {
  supplierId: string;
  branchId: string;
  reason: string;
  note: string | null;
  lines: Array<{ productId: string; qty: number; unitCreditPaise: number }>;
}

// --- Stock -------------------------------------------------------------------------------------

export const stockRowSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string(),
  variant: z.string(),
  barcode: z.string().nullable(),
  qty: z.number().int(),
  minQty: z.number().int().nullable(),
  isLow: z.boolean(),
  // Present only for people with products.cost.read.
  wacPaise: z.number().int().optional(),
  valuePaise: z.number().int().optional(),
});
export type StockRow = z.infer<typeof stockRowSchema>;

export const stockListSchema = z.object({
  branchId: z.string(),
  items: z.array(stockRowSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type StockList = z.infer<typeof stockListSchema>;

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
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const ledgerEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  type: z.enum(LEDGER_TYPES),
  productId: z.string(),
  productName: z.string(),
  qtyDelta: z.number().int(),
  qtyAfter: z.number().int(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  refType: z.string(),
  refId: z.string().nullable(),
  reason: z.string().nullable(),
  note: z.string().nullable(),
  createdByName: z.string().nullable(),
  // Present only for people with products.cost.read.
  unitCostPaise: z.number().int().optional(),
  valueDeltaPaise: z.number().int().optional(),
  wacAfterPaise: z.number().int().optional(),
  valueAfterPaise: z.number().int().optional(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const ledgerListSchema = z.object({
  items: z.array(ledgerEntrySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const stockChangeSchema = z.object({
  productId: z.string(),
  branchId: z.string(),
  qtyBefore: z.number().int(),
  qtyAfter: z.number().int(),
});
export type StockChange = z.infer<typeof stockChangeSchema>;

export const thresholdSchema = z.object({
  branchId: z.string(),
  productId: z.string(),
  minQty: z.number().int(),
});

export const stockSettingsSchema = z.object({ nearExpiryDays: z.number().int() });

export const ADJUSTMENT_REASONS = ['RECOUNT', 'DAMAGE', 'LOST', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const expiryAlertSchema = z.object({
  batchId: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  productId: z.string(),
  productName: z.string(),
  batchNo: z.string().nullable(),
  expiryDate: z.string(),
  qtyRemaining: z.number().int(),
  daysLeft: z.number().int(),
});
export type ExpiryAlert = z.infer<typeof expiryAlertSchema>;

export const alertsSchema = z.object({
  nearExpiryDays: z.number().int(),
  lowStock: z.array(
    z.object({
      branchId: z.string(),
      branchName: z.string(),
      productId: z.string(),
      productName: z.string(),
      qty: z.number().int(),
      minQty: z.number().int(),
    }),
  ),
  nearExpiry: z.array(expiryAlertSchema),
  expired: z.array(expiryAlertSchema),
});
export type Alerts = z.infer<typeof alertsSchema>;

export const verifySchema = z.object({
  ok: z.boolean(),
  checkedPositions: z.number().int(),
  problems: z.array(z.object({ branchId: z.string(), productId: z.string(), problem: z.string() })),
});

// --- Transfers ---------------------------------------------------------------------------------

export const transferSchema = z.object({
  id: z.string(),
  fromBranchId: z.string(),
  fromBranchName: z.string(),
  toBranchId: z.string(),
  toBranchName: z.string(),
  status: z.enum(['IN_TRANSIT', 'RECEIVED', 'CANCELLED']),
  note: z.string().nullable(),
  createdAt: z.string(),
  receivedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  lines: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      qty: z.number().int(),
      batchNo: z.string().nullable(),
      expiryDate: z.string().nullable(),
    }),
  ),
});
export type Transfer = z.infer<typeof transferSchema>;

export const transferListSchema = z.object({ items: z.array(transferSchema) });

// --- Audit -------------------------------------------------------------------------------------

export const auditEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  action: z.string(),
  entity: z.string().nullable(),
  entityId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorRole: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListSchema = z.object({
  items: z.array(auditEntrySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const auditVerifySchema = z.object({
  ok: z.boolean(),
  sealed: z.number().int(),
  unsealed: z.number().int(),
  firstBrokenSeq: z.number().int().nullable(),
  problem: z.string().nullable(),
});
export type AuditVerify = z.infer<typeof auditVerifySchema>;
