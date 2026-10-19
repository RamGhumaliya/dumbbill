import { z } from 'zod';

/**
 * Shapes of the catalogue endpoints, written from the backend's Swagger manual (tags "Products" and "Pricing") and
 * `docs/api/catalogue.md`. If the backend changes one of these, the checks fail with a clear message here instead of
 * silently breaking a screen.
 *
 * COST SECRECY: the API returns cost, margin and "below cost" only to people holding `products.cost.read`. They are
 * OPTIONAL here on purpose: for everyone else the keys are simply not there. A screen must show a cost column only
 * when the person holds that permission (`useCan('products.cost.read')`), never because a field happens to be present.
 */

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultHsn: z.string().nullable(),
  defaultGstRateBp: z.number().int().nullable(),
});
export type Category = z.infer<typeof categorySchema>;

export const productOptionsSchema = z.object({
  categories: z.array(categorySchema),
  /** The GST rates a product may carry, in basis points (1800 = 18%). */
  gstRatesBp: z.array(z.number().int()),
  /** True when the business has a GSTIN, so HSN and GST rate are required on every product. */
  taxDetailsRequired: z.boolean(),
});
export type ProductOptions = z.infer<typeof productOptionsSchema>;

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  variant: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  hsn: z.string().nullable(),
  gstRateBp: z.number().int().nullable(),
  /** MRP in force now, in paise. */
  mrpPaise: z.number().int(),
  /** Selling price in force now, in paise. */
  pricePaise: z.number().int(),
  hasImage: z.boolean(),
  isActive: z.boolean(),
  // Present only for people with products.cost.read.
  purchaseCostPaise: z.number().int().nullable().optional(),
  marginBp: z.number().int().nullable().optional(),
  belowCost: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Product = z.infer<typeof productSchema>;

export const productListSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ProductList = z.infer<typeof productListSchema>;

export const priceSchema = z.object({
  id: z.string(),
  mrpPaise: z.number().int(),
  pricePaise: z.number().int(),
  effectiveFrom: z.string(),
  reason: z.string(),
  changedByName: z.string().nullable(),
  current: z.boolean(),
  scheduled: z.boolean(),
});
export type Price = z.infer<typeof priceSchema>;

export const priceHistorySchema = z.object({ prices: z.array(priceSchema) });

export const importReportSchema = z.object({
  dryRun: z.boolean(),
  fileErrors: z.array(z.string()),
  ignoredColumns: z.array(z.string()),
  totalRows: z.number().int(),
  createdCount: z.number().int(),
  failedCount: z.number().int(),
  categoriesCreated: z.array(z.string()),
  failedRows: z.array(
    z.object({
      rowNumber: z.number().int(),
      errors: z.array(z.object({ field: z.string(), message: z.string() })),
    }),
  ),
});
export type ImportReport = z.infer<typeof importReportSchema>;

/** The descriptive fields of a product, as the form sends them. Blank optional text is sent as null. */
export interface ProductDetailsInput {
  name: string;
  brand: string;
  variant: string;
  categoryId: string | null;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  gstRateBp: number | null;
  /** Only sent by people with products.cost.read; `undefined` leaves the existing cost alone. */
  purchaseCostPaise?: number | null;
}

export interface CreateProductInput extends ProductDetailsInput {
  mrpPaise: number;
  pricePaise: number;
}

export interface ChangePriceInput {
  mrpPaise: number;
  pricePaise: number;
  reason: string;
  /** ISO time; omit for "now". */
  effectiveFrom?: string;
}

export interface ProductQuery {
  q?: string;
  categoryId?: string;
  status?: 'active' | 'inactive' | 'all';
  limit?: number;
  offset?: number;
}
