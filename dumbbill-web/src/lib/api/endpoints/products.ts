import type { ApiClient } from '../client';
import { noContentSchema } from '../schemas/auth';
import { blobSchema } from '../schemas/business';
import {
  categorySchema,
  importReportSchema,
  priceHistorySchema,
  productListSchema,
  productOptionsSchema,
  productSchema,
  type Category,
  type ChangePriceInput,
  type CreateProductInput,
  type ImportReport,
  type Price,
  type Product,
  type ProductDetailsInput,
  type ProductList,
  type ProductOptions,
  type ProductQuery,
} from '../schemas/products';

/**
 * Catalogue endpoints: one function per endpoint, named exactly like the operationId in the Swagger manual.
 * Reading needs `products.read`; changing details `products.write`; setting or changing a price `pricing.write`
 * (the API enforces it; screens only hide what the person cannot do). Money is always whole paise.
 */

/** operationId getProductOptions. Permission: products.read. */
export function getProductOptions(client: ApiClient): Promise<ProductOptions> {
  return client.request({ path: '/v1/products/options', schema: productOptionsSchema });
}

/** operationId listProducts. Permission: products.read. Cost fields appear only for people with products.cost.read. */
export function listProducts(client: ApiClient, query: ProductQuery = {}): Promise<ProductList> {
  return client.request({
    path: '/v1/products',
    query: { ...query },
    schema: productListSchema,
  });
}

/** operationId getProduct. Permission: products.read. */
export function getProduct(client: ApiClient, productId: string): Promise<Product> {
  return client.request({ path: `/v1/products/${productId}`, schema: productSchema });
}

/** operationId getProductByBarcode. Permission: products.read. 404 when no active product has this barcode. */
export function getProductByBarcode(client: ApiClient, barcode: string): Promise<Product> {
  return client.request({
    path: `/v1/products/by-barcode/${encodeURIComponent(barcode)}`,
    schema: productSchema,
  });
}

/** operationId createProduct. Permission: products.write AND pricing.write. */
export function createProduct(client: ApiClient, body: CreateProductInput): Promise<Product> {
  return client.request({ method: 'POST', path: '/v1/products', body, schema: productSchema });
}

/** operationId updateProduct. Permission: products.write. Prices change only through {@link changePrice}. */
export function updateProduct(
  client: ApiClient,
  productId: string,
  body: ProductDetailsInput,
): Promise<Product> {
  return client.request({
    method: 'PUT',
    path: `/v1/products/${productId}`,
    body,
    schema: productSchema,
  });
}

/** operationId deactivateProduct. Permission: products.write. */
export function deactivateProduct(client: ApiClient, productId: string): Promise<Product> {
  return client.request({
    method: 'POST',
    path: `/v1/products/${productId}/deactivate`,
    schema: productSchema,
  });
}

/** operationId activateProduct. Permission: products.write. */
export function activateProduct(client: ApiClient, productId: string): Promise<Product> {
  return client.request({
    method: 'POST',
    path: `/v1/products/${productId}/activate`,
    schema: productSchema,
  });
}

/** operationId getPriceHistory. Permission: products.write. Newest first. */
export async function getPriceHistory(client: ApiClient, productId: string): Promise<Price[]> {
  const result = await client.request({
    path: `/v1/products/${productId}/prices`,
    schema: priceHistorySchema,
  });
  return result.prices;
}

/** operationId changePrice. Permission: pricing.write. Always recorded with who and why. */
export function changePrice(
  client: ApiClient,
  productId: string,
  body: ChangePriceInput,
): Promise<Product> {
  return client.request({
    method: 'POST',
    path: `/v1/products/${productId}/prices`,
    body,
    schema: productSchema,
  });
}

/** operationId uploadProductImage. Permission: products.write. JPEG, PNG or WebP up to 2 MB. */
export function uploadProductImage(
  client: ApiClient,
  productId: string,
  file: File,
): Promise<Product> {
  const form = new FormData();
  form.append('file', file);
  return client.request({
    method: 'PUT',
    path: `/v1/products/${productId}/image`,
    body: form,
    schema: productSchema,
  });
}

/** operationId getProductImage. Permission: products.read. Needs the token, so it is fetched as a Blob. */
export function getProductImage(
  client: ApiClient,
  productId: string,
  size: 'full' | 'thumb' = 'full',
): Promise<Blob> {
  return client.request({
    path: `/v1/products/${productId}/image`,
    query: { size },
    expect: 'blob',
    schema: blobSchema,
  });
}

/** operationId removeProductImage. Permission: products.write. */
export function removeProductImage(client: ApiClient, productId: string): Promise<void> {
  return client.request({
    method: 'DELETE',
    path: `/v1/products/${productId}/image`,
    schema: noContentSchema,
  });
}

/** operationId importProducts. Permission: products.write AND pricing.write. `dryRun` checks the file and saves nothing. */
export function importProducts(
  client: ApiClient,
  file: File,
  dryRun: boolean,
): Promise<ImportReport> {
  const form = new FormData();
  form.append('file', file);
  return client.request({
    method: 'POST',
    path: '/v1/products/import',
    query: { dryRun },
    body: form,
    schema: importReportSchema,
  });
}

/** operationId createCategory. Permission: products.write. */
export function createCategory(
  client: ApiClient,
  body: { name: string; defaultHsn?: string | null; defaultGstRateBp?: number | null },
): Promise<Category> {
  return client.request({
    method: 'POST',
    path: '/v1/products/categories',
    body,
    schema: categorySchema,
  });
}
