# Catalogue and pricing: guide for app developers

For web and mobile developers. The Swagger manual (`/docs`, tags **Products** and **Pricing**) lists every field; this page explains how the pieces fit together. Reasoning: `docs/adr/011-catalogue-and-pricing.md`.

## Who may call what

| Endpoint | Permission |
|---|---|
| `GET /v1/products/options`, `GET /v1/products`, `GET /v1/products/{id}`, `GET /v1/products/by-barcode/{barcode}`, `GET /v1/products/{id}/image` | `products.read` |
| `PUT /v1/products/{id}`, `POST /v1/products/{id}/deactivate`, `/activate`, `PUT/DELETE /v1/products/{id}/image`, `GET /v1/products/{id}/prices`, `POST /v1/products/categories` | `products.write` |
| `POST /v1/products/{id}/prices` | `pricing.write` |
| `POST /v1/products`, `POST /v1/products/import` | `products.write` AND `pricing.write` |

Hide what the person cannot do (read `access.permissions` from login or `/v1/auth/me`); the API refuses it anyway with `403 FORBIDDEN`. Another business's product is `404 NOT_FOUND`.

## Two shapes of a product (cost secrecy)

Every product answer comes in one of two shapes, chosen by the caller's permission, **not** by the route:

- **`ProductCashierDto`** (everyone with `products.read`): `id, name, brand, variant, categoryId, categoryName, sku, barcode, hsn, gstRateBp, mrpPaise, pricePaise, hasImage, isActive`. There is no cost, margin or profit field, and never will be.
- **`ProductAdminDto`** (only people with `products.cost.read`): the same plus `purchaseCostPaise`, `marginBp` (basis points of the price), `belowCost`, `createdAt`, `updatedAt`.

Rules for apps: show a cost column only when the person holds `products.cost.read` (not because a field happens to be present); never ask a cashier's device for a field that does not exist; never put cost into your own logs or caches that cashiers can read.

`mrpPaise` and `pricePaise` are the prices **in force now**. Money is always whole paise (`299900` = ₹2,999).

## Products

`POST /v1/products` (and `PUT /v1/products/{id}` without the two prices):

```json
{ "name": "Gold Standard 100% Whey", "brand": "Optimum Nutrition", "variant": "2 kg / Chocolate",
  "categoryId": "…", "sku": "ON-GS-2KG-CHOC", "barcode": "748927052145",
  "hsn": "21069099", "gstRateBp": 1800, "mrpPaise": 349900, "pricePaise": 299900,
  "purchaseCostPaise": 240000 }
```

- A **variant is its own product** with its own barcode and price.
- `GET /v1/products/options` gives the categories, the allowed GST rates (`gstRatesBp`, e.g. `[0, 25, 300, 500, 1800, 4000]`) and `taxDetailsRequired`. When it is `true` (the business has a GSTIN) HSN and GST rate are required.
- `400 VALIDATION_FAILED` with `errors[]` for bad shapes, a missing HSN/GST, an unknown category, a price above the MRP.
- `409 CONFLICT` with `errors[]` naming `barcode`, `sku` or `name` when another product already has it. Show the message under that box.
- `purchaseCostPaise` may be sent only with `products.cost.read` (`403` otherwise). On `PUT`, leave it out to keep the current cost.
- `GET /v1/products` takes `q` (searches name, brand, variant, SKU, barcode), `categoryId`, `status` (`active` default, `inactive`, `all`), `limit` (1 to 200, default 50) and `offset`; the answer is `{ items, total, limit, offset }` sorted by name.
- `GET /v1/products/by-barcode/{barcode}` finds an **active** product for the till; `404` when none.
- Products are **switched off** with `POST …/deactivate` (safe to repeat) and back with `…/activate`. They are never deleted.

## Prices and history

`POST /v1/products/{id}/prices`:

```json
{ "mrpPaise": 349900, "pricePaise": 279900, "reason": "Diwali offer", "effectiveFrom": "2026-11-01T00:00:00.000Z" }
```

- A price is **never edited**: this adds a row. `reason` is required (3 to 200 characters). `effectiveFrom` is optional: leave it out for "now", or give a later time to **schedule** the change (the price in force does not change until then).
- `400` for a price above the MRP or a start in the past (`errors[].field` is `pricePaise` or `effectiveFrom`). `422 BUSINESS_RULE_VIOLATION` when the product already has exactly this price.
- `GET /v1/products/{id}/prices` returns the history newest first: `{ prices: [{ id, mrpPaise, pricePaise, effectiveFrom, reason, changedByName, current, scheduled }] }`. Exactly one row has `current: true`; scheduled rows have `scheduled: true`.

## Pictures

`PUT /v1/products/{id}/image` takes `multipart/form-data` with one field `file` (JPEG, PNG or WebP, up to 2 MB). The server decodes it and stores two clean WebP files (800 px and 160 px), so the upload itself is never kept. Errors: `415 FILE_TYPE_NOT_ALLOWED`, `422 FILE_CONTENT_MISMATCH` (not a real picture, or too many pixels), `413 PAYLOAD_TOO_LARGE`.

`GET /v1/products/{id}/image?size=thumb|full` needs the bearer token, so an `<img src>` link cannot fetch it: download it with the API client and show it from memory (the web app reads it as a Blob and shows a `data:` address). `404` when there is none.

## CSV import

`POST /v1/products/import` (multipart, field `file`, optional `?dryRun=true`). Columns (any order, any letter case): `name*, brand, category, variant, sku, barcode, hsn, gst_percent, mrp*, price*, cost`. Amounts in **rupees** (`1,499.50`), GST as a percentage (`18`). Up to 2000 rows and 2 MB; UTF-8 with or without the Excel byte-order mark.

The answer is always `200` with a report:

```json
{ "dryRun": true, "fileErrors": [], "ignoredColumns": ["colour"], "totalRows": 120,
  "createdCount": 118, "failedCount": 2, "categoriesCreated": ["Pre-workout"],
  "failedRows": [{ "rowNumber": 7, "errors": [{ "field": "mrp", "message": "Write the MRP in rupees, for example 1499.50." }] }] }
```

- `dryRun=true` checks everything and saves nothing. The real run creates the valid rows and reports each failed row (`rowNumber` is the spreadsheet row; the header is row 1).
- `fileErrors` lists problems with the file as a whole (missing `name`, `mrp` or `price` column, no rows, not valid CSV, more than 2000 rows); then no row was read.
- A `cost` value needs `products.cost.read`; without it that row fails with `field: "cost"`.
- Importing the same file again creates nothing: those rows now exist and fail as duplicates.

## Categories

`POST /v1/products/categories` `{ "name": "Pre-workout", "defaultHsn": "21069099", "defaultGstRateBp": 1800 }` (`products.write`). The name is unique ignoring case (`409` with `errors[].field = "name"`). Categories come back from `GET /v1/products/options`. A category's HSN and GST rate are **suggestions** that pre-fill the product form; the CA decides the real values per product.

## Audit

`product.created`, `product.updated` (`metadata.changedFields` lists field NAMES only), `product.deactivated`, `product.activated`, `product.price_changed` (new and previous price, start time, reason), `product.image_changed`, `product.image_removed`, `product.imported` (counts), `category.created`. Cost values are never written to the audit log.
