# ADR 011: Catalogue, prices with history, pictures and CSV import

- Status: Accepted (20 Oct 2026, implemented in P1-4)
- Deciders: Owner, architect agent
- Related: ADR 004 (money as paise), ADR 009 (permissions), user stories US-PROD-01, US-PRICE-01, journey J2, `docs/api/catalogue.md`, `docs/runbooks/file-storage.md`

## 1. Context

The catalogue is what every bill, stock figure and report refers to, so its rules have to hold from the start. Four things matter most:

1. **A price on a bill must be provable.** If a price can be edited, nobody can later say what a customer should have been charged.
2. **Cost must never reach the till.** A cashier who sees what an item costs the shop can work out the margin; the owner promised cashiers would never see it (hard rule 3).
3. **Tax details are required on a tax invoice.** A shop with a GSTIN must give every product an HSN code and a GST rate.
4. **Shops arrive with spreadsheets.** Typing 400 products by hand is a reason to leave.

## 2. Decision

### Products

1. **A variant is its own product row.** "2 kg / Chocolate" and "5 lb / Vanilla" each have a barcode, SKU and price; they share a name and brand. This keeps stock, barcodes and tax per sellable item and avoids a parent/child model nobody needs yet.
2. **Three things are unique inside a business:** the barcode, the SKU, and name + brand + variant (ignoring case). Two businesses may use the same barcode. The service checks first so the answer names the exact field; the unique indexes catch two simultaneous requests.
3. **HSN and GST rate are required when the business has a GSTIN** (US-PROD-01), and optional otherwise. HSN must be 4, 6 or 8 digits. The GST rate must come from one list in code (`domain/gst-rates.ts`): 0, 0.25, 3, 5, 18 and 40 percent, the slabs in force after the September 2025 reform. The database guards only the range (0 to 100 percent), because the list changes by law and a migration per change would be silly. **The CA must confirm the list** (open question).
4. **Products are switched off, never deleted**, because invoices and stock will refer to them. A switched-off product disappears from the till and the default list.
5. **Categories belong to the business.** New businesses get a copy of the five category templates (with suggested HSN and GST); existing ones got the same in the migration. Suggestions pre-fill the form; they are never forced onto a product.

### Prices

6. **There is no price column on a product.** Prices live in `price_history` (MRP, selling price, who, why, effective-from). The price in force is the newest row whose start time has passed. A bill therefore uses the price that was valid at bill time (US-PRICE-01).
7. **`price_history` is append-only** in three layers: the app role has no UPDATE or DELETE right, a trigger refuses them for everyone (including a script with the owner password), and the table is listed in the append-only set inside `app_grant_defaults()` so a later migration cannot reopen it.
8. **Changing a price needs a reason** (3 to 200 characters) and records the person. A change may start now or later (a scheduled price); it may **not start in the past**, because a past price would quietly rewrite what earlier bills should have charged. A "change" to the price already in force is refused as noise.
9. **A selling price may not exceed the MRP** (selling above MRP is illegal in India). Checked in the API and by a database constraint.
10. **Creating a product needs `products.write` and `pricing.write`; editing its details needs only `products.write`; changing a price needs `pricing.write`.** Editing details never touches a price.
11. **Per-branch prices are not built.** The architecture sketch has a nullable branch on the price row; no story needs it yet, and adding it later is a new column, not a rewrite.

### Cost secrecy

12. **Two response types.** `ProductCashierDto` has no field for cost, margin or anything derived from it. `ProductAdminDto` adds `purchaseCostPaise`, `marginBp`, `belowCost`, and is returned only to people holding `products.cost.read`. Which type a caller gets is decided by the permission, not by the route, so a person with `products.write` but no cost access (a custom role) still gets the safe type.
13. **Sending a cost without `products.cost.read` answers 403**, on create, update and in the CSV import. Leaving the cost out of an update keeps the existing one.
14. **The cost never appears in the audit log or logs.** Audit entries record the NAMES of the fields that changed (`changedFields`), never values; a price change records prices (not secret) but not cost.
15. **The cost is entered by hand for now** (`purchaseCostPaise`). Purchases and weighted average cost (P1-5) will supersede it for profit figures; until then it gives the owner a margin and a "below cost" warning.
16. **A leak scanner is part of the test suite**: every product response a cashier can obtain is searched for any key matching cost, margin, profit, wac, purchase, landed or cogs, and for the cost VALUE itself; the written API contract (Swagger) is checked the same way.

### Pictures

17. **Uploads are decoded and re-encoded**, never stored as sent. `sharp` reads the file (proving it is a real JPEG, PNG or WebP), applies the camera rotation, and writes two WebP files: 800 px and a 160 px thumbnail. Everything else the upload carried (scripts, GPS position, other metadata) is thrown away. Decoded size is capped at 25 megapixels against decompression bombs; the upload is capped at 2 MB.
18. **Pictures are private.** They are streamed through an authenticated route (`products.read`), with the storage key taken from the business's own product row, never from the request. Folders are per business, names are random.
19. **Virus scanning is not built.** Re-encoding already removes the usual picture-borne risks; a scanner (ClamAV) needs a daemon we do not run locally. The hook is the single place where the upload is decoded (`images/product-images.ts`). Recorded as an open question.

### CSV import

20. **Check first, then import.** `POST /v1/products/import?dryRun=true` validates every row and saves nothing; the real run creates the valid rows and reports each failed row with the exact problem and the spreadsheet row number. Running the same file again creates nothing new (the rows now exist and clash).
21. **Amounts are rupees in the file and paise in the system**, converted by reading the digits as text (no decimal arithmetic, so 19.99 is exactly 1999). At most two decimals, at most Rs 1 crore.
22. **Limits:** 2000 rows, 2 MB, UTF-8 with or without the Excel byte-order mark, quoted commas and line breaks supported. The CSV reader is written here (about 60 lines, fully tested) rather than adding a dependency.
23. **Categories named in the file are matched ignoring case and created when missing**, and listed in the report so a typo is visible.

### Web

24. **The table is dense and keyboard-first.** Sticky header, search and filters, a column picker (remembered in the browser), and prices that can be changed from the keyboard: Arrow Up and Down move between rows, Enter edits, Enter again opens the price dialog, Escape cancels. Nothing is saved from the cell itself, because a price needs a reason; the dialog always has the last word.
25. **Cost and margin columns do not exist for people without cost access** (not hidden: absent, in the table, the column picker and the form), and the form never sends a cost for them.

## 3. Consequences

Good:
- A bill's price can always be explained: who changed it, when, why, and from what.
- A cashier cannot learn a cost from any product response, by any route, in any role arrangement, and a test fails the build if one ever does.
- Tax data is complete before it is needed on an invoice.
- A shop can load its catalogue in minutes and is told exactly which rows to fix.

Costs and caveats:
- **One extra query per product list for prices** (the price rows of the page's products). Fine at this size; a materialised "current price" can be added if a catalogue passes tens of thousands of rows.
- **A product that only has a future-dated first price would show no price.** Creation always records the first price as starting now, so this cannot happen through the API.
- **`purchaseCostPaise` is typed by hand** and can be wrong; P1-5 replaces it with real purchase costs.
- **The GST rate list is a snapshot of the law** and needs the CA's confirmation. Old products imported with 12% or 28% are refused until the list is widened or the rate corrected.
- **No virus scan and no per-branch prices yet** (above).
- **Two simultaneous price changes to one product** are both recorded (append-only); the one with the later start wins, ties broken by when they were recorded.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Store the current price on the product and keep history on the side | Two sources of truth; the product row would be edited, and a bug could change a price without a history row. |
| Let the audit log be the price history | The audit log is for investigation; the till needs fast "price at time T" queries. |
| One response type with cost fields set to null for cashiers | The key would still be there, and one forgotten code path leaks. Different types make a leak impossible to type. |
| Parent product with child variants | More tables and screens for no gain: stock, barcode and tax are per variant anyway. |
| Store uploads as sent and trust the content type | A renamed script or a huge picture would sit on our disk; re-encoding costs milliseconds. |
| Import everything or nothing | One typo would block 399 good rows; row-level reports let the owner fix just what failed. |
| Numeric (decimal) money in the CSV path | Floating point would put a paisa off on some prices; reading text is exact. |
| Allow back-dated prices | Would silently change what earlier bills should have charged. |

## 5. How we know it works

- `test/unit/catalogue.spec.ts` (48): rupees to paise is exact (19.99 is 1999) and refuses nonsense; GST rates; the CSV reader (quotes, BOM, line ends, unclosed quote); field and price rules; margin; every import problem reported per row with the right row number; duplicates inside a file; the picture processor (sizes, proportions, no enlarging, text renamed to .png, GIF, decompression bomb).
- `test/integration/catalogue-flow.spec.ts` (37): create / read / search / page / barcode lookup; switching off and on; edits audited by field NAME; uniqueness per field and per business; HSN/GST required only with a GSTIN; price rules; **the history** (who, why, newest started price wins, scheduled price applies only after its time, a start in the past refused, editing details never changes a price); permissions for cashier, writer without pricing, 404 for another business on every product route; **the cashier-leak scanner**; pictures (sizes, headers, refused fakes, replace and remove, per-business folders); CSV import (dry run, partial import, clashes, cost column, file errors, BOM and quoted commas, the checklist).
- `test/integration/permission-matrix.spec.ts` and `swagger-completeness.spec.ts` cover the 15 new routes automatically (every route declared; Swagger "Permission:" line matches).
- `test/security/catalogue-db-security.spec.ts` (14): products, categories and prices are walled off per business; the price history refuses UPDATE and DELETE to the app role AND to the table owner; bad barcode, HSN, GST range, negative cost, blank name, price above MRP, blank reason, repeated identity are refused by the database.
- Web: 33 browser tests (real Chromium, pretend API) including axe in both themes on five screens, the keyboard price flow, the cashier view having no cost column, and no cost sent by someone without cost access; unit tests for rupee parsing.
- A sabotage check broke 12 protections one at a time and the tests caught every one: the cashier getting the admin shape, a cost accepted without permission (API and CSV), the cost written to the audit log, the oldest price treated as current, scheduled prices applying at once, past-dated prices, a price above MRP, HSN/GST never required, a repeated barcode not pre-checked, a GIF accepted as a picture, and changing a price needing only `products.read`.
- A live run with real PostgreSQL, Redis, Mailpit and a real browser: a CSV checked then imported (3 bad rows each explained), a real picture saved as an 800 px WebP, a price changed from the keyboard with the history showing both prices, an UPDATE and a DELETE on the price history refused even with the owner password, a cashier whose API answer contains no cost-like word and whose table has no cost, margin or action columns, and an audit trail with no cost in it.
