# Purchasing, stock and the audit log: guide for app developers

For web and mobile developers. The Swagger manual (`/docs`, tags **Suppliers**, **Purchases**, **Inventory**, **Audit**) lists every field; this page explains how the pieces fit together. Reasoning: `docs/adr/012-purchasing-stock-and-audit-chain.md`.

## Who may call what

| Endpoints | Permission |
|---|---|
| `GET /v1/stock` | `products.read` (quantities only; cost fields need `products.cost.read`) |
| `GET /v1/stock/ledger`, `POST /v1/stock/adjustments`, `POST /v1/stock/write-offs`, `PUT /v1/stock/thresholds`, `GET /v1/stock/alerts`, `GET /v1/stock/verify` | `stock.adjust` |
| `POST /v1/stock/rebuild`, `GET/PUT /v1/stock/settings` | `settings.manage` |
| `POST/GET /v1/stock/transfers`, `GET /v1/stock/transfers/{id}`, `POST .../receive`, `POST .../cancel` | `stock.transfer` |
| `/v1/suppliers/*`, `/v1/purchases/*`, `/v1/supplier-returns/*` | `purchases.write` |
| `GET /v1/audit`, `GET /v1/audit/verify` | `audit.read` |

Every branch-bound call also needs the person to be allowed to use that branch (`403` otherwise). Another business's records are `404`.

## The Idempotency-Key header (required on every POST that changes stock or enters a bill)

`POST /v1/purchases`, `/v1/supplier-returns`, `/v1/stock/adjustments`, `/v1/stock/write-offs`, `/v1/stock/transfers`.

- Make **one random key per form** (a UUID is ideal; 8 to 100 letters, digits, dashes or underscores) and send it as `Idempotency-Key`. A fresh form gets a fresh key.
- If the answer is lost (timeout, dropped connection, double tap), **resend the SAME request with the SAME key**. The server returns the saved answer with the header `Idempotent-Replayed: true` and does nothing a second time.
- If the first attempt FAILED (validation error, not enough stock), the key is not used up: fix the form and send again with the same key.
- The same key with a different body is `409 IDEMPOTENCY_KEY_REUSED`. A missing or malformed key is `400 BAD_REQUEST`.
- Mobile apps: store the key with the pending form so a retry after a restart reuses it.

## Money and cost

Money is whole paise. `purchases.write` routes show costs (the person entering a bill knows them). **Stock rows and ledger entries are returned in two shapes by permission, not by route:** `StockRowCashierDto` / `LedgerEntryDto` have no cost, value or average cost; `StockRowAdminDto` / `LedgerEntryAdminDto` add `wacPaise`, `valuePaise` (and per movement `unitCostPaise`, `valueDeltaPaise`, `wacAfterPaise`, `valueAfterPaise`) and go only to people with `products.cost.read`. Show cost columns only when the person holds that permission; never because a field is present. Transfers and audit entries never carry money.

## Suppliers

`POST /v1/suppliers` / `PUT /v1/suppliers/{id}` take `name` (unique, ignoring case) and optional `gstin` (check character verified), `phone`, `email`, `addressLine`, `city`, `notes`. `409 CONFLICT` with `errors[].field = "name"` for a repeated name; `400` with `errors[].field = "gstin"` for a typing mistake. `POST .../deactivate` and `.../activate` switch a supplier off or on (never deleted). `balancePaise` = what is owed: their bills minus debit-note credit (**payments are not recorded yet**).

## Purchases

```json
POST /v1/purchases   Idempotency-Key: 7f9c2a40-3c7e-4b52-9a39-0b1d1f6e2c11
{ "supplierId": "…", "branchId": "…", "invoiceRef": "NDP/2410/0417", "invoiceDate": "2026-10-19",
  "otherCostPaise": 150000, "note": null,
  "lines": [ { "productId": "…", "qty": 24, "unitCostPaise": 249900, "batchNo": "WH2410A", "expiryDate": "2027-09-30" } ] }
```

- Freight (`otherCostPaise`) is spread over the lines in proportion to their value, to the paisa; each answer line has `allocatedCostPaise`, `lineTotalPaise` (landed) and `landedUnitCostPaise`. Stock is added at the landed value, which updates the weighted average cost.
- `400 VALIDATION_FAILED` with `errors[]` such as `lines[0].expiryDate` ("This batch has already expired."), `invoiceDate` (not in the future), `lines[0].productId` (unknown or switched off). Map `lines[i].field` to the row `i`.
- `409 CONFLICT` with `errors[].field = "invoiceRef"`: this supplier's invoice number is already entered.
- `422 BUSINESS_RULE_VIOLATION`: switched-off supplier or branch, or a bill over Rs 2,00,00,000.
- The whole purchase is saved or nothing is. A saved purchase is never edited; correct it with a supplier return or a count.
- `GET /v1/purchases` (newest first, `limit` up to 200, `offset`, optional `supplierId` and `branchId`) and `GET /v1/purchases/{id}`.

## Supplier returns (debit notes)

`POST /v1/supplier-returns` `{ supplierId, branchId, purchaseId?, reason, note?, lines: [{ productId, batchId?, qty, unitCreditPaise }] }`. Stock leaves at its average cost (from the named batch, or the batches that expire first); the credit lowers what is owed. The answer has `debitNoteNo` (`DN-0001`, counted per business, no gaps). `422 INSUFFICIENT_STOCK` saves nothing (not even a number). `GET /v1/supplier-returns` and `/{id}`.

## Stock

- `GET /v1/stock?branchId=…` (required) with `q`, `categoryId`, `lowOnly`, `limit` (max 200), `offset`: every active product with `qty` (0 if never stocked), `minQty` and `isLow`.
- `GET /v1/stock/ledger?branchId=…&productId=…&type=…`: newest first; each entry has `type` (`PURCHASE`, `SALE`, `SALE_RETURN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `TRANSFER_OUT`, `TRANSFER_IN`, `TRANSFER_CANCEL`, `SUPPLIER_RETURN`, `EXPIRY_WRITE_OFF`), `qtyDelta`, `qtyAfter`, batch and expiry, `refType`/`refId`, `reason`, `note`, `createdByName`. The ledger cannot be edited or deleted.
- `POST /v1/stock/adjustments` `{ branchId, productId, countedQty, reason: RECOUNT|DAMAGE|LOST|OTHER, note?, batchId?, unitCostPaise? }` sets stock to the count and records the difference (answer: `qtyBefore`, `qtyAfter`). `422` when the count equals the books. Found units are valued at the current average cost.
- `POST /v1/stock/write-offs` `{ branchId, batchId, qty?, note? }` writes off an EXPIRED batch only (`422` otherwise; use a count with `DAMAGE` for damaged goods).
- `PUT /v1/stock/thresholds` `{ branchId, productId, minQty }` sets the low-stock level (0 = off).
- `GET /v1/stock/alerts?branchId=…` returns `{ nearExpiryDays, lowStock[], nearExpiry[], expired[] }` (each expiry row has `daysLeft`, negative once expired). `GET/PUT /v1/stock/settings` `{ nearExpiryDays }` (1 to 365).
- `GET /v1/stock/verify` answers `{ ok, checkedPositions, problems[] }` (levels vs ledger, batches vs levels). `POST /v1/stock/rebuild` corrects them from the ledger.

## Transfers

`POST /v1/stock/transfers` `{ fromBranchId, toBranchId, note?, lines: [{ productId, qty }] }` takes the goods out of the sending branch now (status `IN_TRANSIT`: in neither branch's stock). `POST .../{id}/receive` (needs the RECEIVING branch) brings them in at the value they left with, in the same batches. `POST .../{id}/cancel` (needs the SENDING branch) returns them. Either happens once: a second attempt is `409 CONFLICT`. `422 INSUFFICIENT_STOCK` saves nothing.

## Audit log

`GET /v1/audit` filters: `action` (event name prefix, e.g. `stock.`), `entity`, `actorUserId`, `from`, `to` (ISO times), `limit` (max 100), `offset`. Each entry has the actor, the **role they held at the time**, address and device, `metadata`, and `before`/`after` where recorded. `GET /v1/audit/verify` checks the tamper-evident chain: `{ ok, sealed, unsealed, firstBrokenSeq, problem }`. Entries are sealed whenever the log is viewed or verified.

Events added in P1-5: `supplier.created|updated|deactivated|activated`, `purchase.created`, `supplier_return.created`, `stock.adjusted`, `stock.expiry_written_off`, `stock.threshold_set`, `stock.settings_changed`, `stock.rebuilt`, `stock.transfer_sent|received|cancelled`. None carries an amount.
