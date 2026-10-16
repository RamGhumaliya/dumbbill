# Architecture

## 1. System overview
```
 Next.js (Admin+POS PWA) ─┐
 Flutter Owner App ───────┼─► CloudFront/WAF ─► ALB ─► NestJS API (ECS Fargate, N tasks)
 Flutter Customer App ────┘                              │  ├─ Postgres (RDS, Multi-AZ, PITR) + RLS
                                                         │  ├─ Redis (ElastiCache): rate-limit, cache, queues
                                                         │  ├─ File storage (images, invoice PDFs, exports): server disk today via the `FileStorage` interface, S3 later; never public, served through authenticated routes
                                                         │  ├─ SES (email), FCM (push), Razorpay (billing webhooks)
                                                         │  └─ Worker (BullMQ): PDFs, exports, digests, webhooks, sync jobs
 Observability: Sentry · OpenTelemetry→CloudWatch/X-Ray · Pino JSON→CloudWatch Logs
```
Modular monolith (NestJS modules) first. Hosting shown below is the future target; today everything runs locally. Split services only on proven need.

## 2. Repository layout (one git repo: docs + 3 app folders)
```
dumbbill-backend/  NestJS + Prisma: src/modules/*, prisma/, test/, docker-compose.yml (pg, redis, mailpit)
dumbbill-web/      Next.js: (owner) (pos) (admin) route groups, components/ui design system, features/*, lib/api
dumbbill-mobile/   Flutter: lib/core, lib/features/* (data/domain/presentation), entrypoints owner + customer
docs/                planning, design, prompts, tracker (workspace root, not shipped)
```
The contract between repos is the backend's **Swagger/OpenAPI** (see `api-docs-standard.md`); web and mobile write typed API layers by hand against it. Design tokens come from one tokens JSON copied into web and mobile and converted by a script in each. Infrastructure-as-code is deferred until deployment is decided.

## 3. Backend module map
`auth · tenants · branches · users/roles · products · pricing · suppliers · purchases · inventory(ledger, costing) · pos(invoices, payments, approvals, shifts) · tax · loyalty(memberships, rules, offers) · reports · billing(subscriptions) · notifications · files · audit · admin(super) · health`.
Rules: modules talk via service interfaces, never reach into another module's tables; cross-module writes go through domain services in one DB transaction.

## 4. Multi-tenancy & RLS
**Implemented in P0-2. The authoritative description, caveats and the add-a-table checklist are in `docs/adr/002-prisma-rls.md`.** The notes below are the original design; where they differ (policy uses `app_current_tenant_id()` and fails closed; the helper is the SQL function `enable_tenant_rls`; the app role is `dumbbill_app`), the ADR wins.

- Every tenant table has `tenant_id uuid not null`; composite indexes lead with `tenant_id`.
- Request pipeline: JWT → `TenantContext` → per-request transaction `BEGIN; SET LOCAL app.tenant_id = $1; SET LOCAL app.user_id = $2;`.
- Policy template:
```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY; ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```
- App connects as `app_user` (no BYPASSRLS, not table owner). Migrations run as `migrator`. Super-admin/system jobs use a separate role and explicit audited code path.
- Branch scoping is enforced in services via `BranchScopeGuard` + query helper (RLS handles tenant; app handles branch).
- Prisma: wrap each request in `prisma.$transaction` and call `set_config('app.tenant_id', $1, true)` (transaction-local) via a `TenantTx` helper. Pooling in transaction mode stays compatible.
- CI test: for each table, a generated test asserts RLS enabled + policy exists + cross-tenant read returns 0 rows.

## 5. Core data model (abridged)
```
tenants(id, name, gstin, state_code, plan_id, status, ...)
branches(id, tenant_id, name, address, state_code, invoice_prefix, printer_width, ...)
users(id, tenant_id, email, password_hash, role, status, mfa_*, ...)
user_branches(user_id, branch_id)  role_permissions(user_id, permission_key, limit_json)
products(id, tenant_id, name, brand, category_id, variant, sku, barcode, hsn, gst_rate_bp, image_key, active)
price_history(id, tenant_id, product_id, branch_id NULL, mrp_paise, price_paise, effective_from, changed_by, reason)
suppliers(id, tenant_id, name, gstin, phone, ...)
purchases(id, tenant_id, branch_id, supplier_id, invoice_ref, invoice_date, other_cost_paise, status)
purchase_lines(id, purchase_id, product_id, qty, unit_cost_paise, allocated_cost_paise, batch_no, expiry_date)
stock_ledger(id, tenant_id, branch_id, product_id, batch_id NULL, type, qty_delta, unit_cost_paise, wac_after_paise,
             ref_type, ref_id, reason, created_by, created_at)           -- APPEND ONLY
stock_levels(branch_id, product_id, qty, wac_paise, version)             -- projection, rebuilt from ledger
invoices(id, tenant_id, branch_id, number, fy, status, customer_id NULL, subtotal_paise, discount_*, tax_*, round_off, total_paise,
         cashier_id, approved_by NULL, idempotency_key UNIQUE, created_at)  -- immutable once FINAL
invoice_lines(id, invoice_id, product_id, qty, mrp, unit_price, discount_*, taxable, cgst, sgst, igst, cost_at_sale_paise)
payments(id, invoice_id, method, amount_paise, ref)
credit_notes(...)   shifts(...)   invoice_sequences(branch_id, fy, next_no)
customers(id, email, password_hash, name, phone, verified_at)            -- GLOBAL (no tenant_id)
memberships(id, tenant_id, customer_id, status, points_balance, joined_via)
loyalty_rules(...)  offers(...)  coupons(...)  points_ledger(...)  -- points_ledger append-only
audit_log(id, tenant_id, actor_id, actor_role, action, entity, entity_id, before, after, ip, ua, at)  -- append-only
plans(...)  subscriptions(...)  webhook_events(id, provider, event_id UNIQUE, payload, processed_at)
```
Notes: `customers` is global, so access is through `memberships`; customers can never query tenant tables directly and a separate `customer_api` role/policy set is used. Partition `stock_ledger`, `audit_log`, `invoices` by month when > 50M rows.

## 6. Weighted-average cost engine
- On `PURCHASE`: `new_wac = (old_qty·old_wac + in_qty·(unit_cost + allocated_landed)) / (old_qty + in_qty)`; stored on ledger row (`wac_after`).
- On `SALE`: `cost_at_sale = current wac`; WAC unchanged. Stored on invoice line (COGS snapshot).
- On `RETURN` (sale return): restocks at original `cost_at_sale`. `TRANSFER`: out at source WAC, in at same cost.
- Negative stock: tenant policy `BLOCK | ALLOW_WITH_WARNING`; if allowed, costed at last known WAC.
- Concurrency: `SELECT … FOR UPDATE` on `stock_levels` row; ordered locking by product_id to avoid deadlocks.
- Rebuild job + nightly invariant check: `Σ ledger == stock_levels`.
- Batches tracked for expiry; costing is at product+branch level (FIFO later is a strategy-interface swap `CostingStrategy`).

## 7. Checkout algorithm (server-authoritative)
1. Validate idempotency key (return existing if present).
2. Load prices effective now, stock, tax config. **Ignore client-sent prices/totals** (client sends product ids, qty, discount intent).
3. Compute line math in integer paise → discounts (item then bill, pro-rata allocation) → tax → round-off.
4. Check cashier limit; if exceeded require `approval_token` (short-lived, bound to cart hash).
5. Single DB transaction: lock stock rows, decrement ledger, insert invoice/lines/payments, allocate invoice number, loyalty earn/redeem, audit.
6. Enqueue PDF + WhatsApp link generation. Return cashier-DTO (no cost fields).

## 8. Offline-tolerant POS
- PWA + Service Worker caches app shell; catalogue snapshot (products, prices, tax, customer lookups) in IndexedDB, delta-synced via `updated_since` cursor.
- Offline sale: client builds a draft with a UUID idempotency key and **pre-allocated invoice number block** (server leases a block of 50 numbers per terminal so numbering stays gap-free & unique); stored encrypted (WebCrypto, key from session).
- On reconnect: queue replays FIFO to `POST /pos/invoices:sync`; server re-validates; outcomes: `ACCEPTED`, `ACCEPTED_WITH_ADJUSTMENT` (price/stock drift, flagged for admin), `REJECTED` (needs manual fix). Nothing discarded; UI shows resolution queue.
- Limits: max 24 h or 200 offline bills; discounts above threshold and refunds are online-only.
- Printing is local, so receipts print offline (marked "provisional" until synced if the tenant chooses).

## 9. API conventions
- REST, `/v1`, resource-oriented; OpenAPI generated from NestJS decorators (`@nestjs/swagger`) with class-validator DTOs; documented per `api-docs-standard.md`; consumers write typed clients by hand.
- Auth: access JWT (15 min) in memory; refresh token in httpOnly Secure SameSite=Strict cookie for web (rotation + reuse detection); mobile uses secure storage. Customers and staff use separate audiences/issuers.
- Errors: RFC 9457 problem+json `{type, title, status, code, detail, requestId, errors[]}`. Stable machine `code`s (`DISCOUNT_EXCEEDS_LIMIT`).
- Pagination: cursor-based; filtering via explicit query params; max page 100.
- Idempotency-Key required on POSTs that create money records. ETag/If-Match on updates to prevent lost updates.
- Rate limits: per IP, per user, per tenant (Redis sliding window), stricter on auth & OTP-like endpoints.
- Versioning: additive changes only inside `/v1`; deprecation header; mobile min-version gate (`/v1/meta`).
- Response shaping: DTO classes per audience (`ProductCashierDto` vs `ProductAdminDto`), `class-transformer` `@Exclude` is **not** relied upon alone; types differ.

## 10. File handling
**Decision (16 Oct 2026): files are stored on the server disk for now** (`LocalDiskStorage`, folder `STORAGE_LOCAL_DIR`, keys `<tenant>/<category>/<uuid>.<ext>`). The rest of the app depends only on the `FileStorage` abstract class, so an S3 driver can replace it later. Limits: single server only (no load-balanced API servers until S3), back up the folder with the database. Upload/download routes arrive in P1-4 behind login and permissions. The S3 design below remains the future target.

Future S3 design: direct-to-S3 presigned PUT (content-type & size limited, virus-scan via Lambda/ClamAV before activation), images processed to WebP variants, private bucket + CloudFront signed URLs for invoices. Invoice PDF is rendered server-side (Playwright/Chromium or `@react-pdf`), cached in S3.

## 11. Background jobs
BullMQ on Redis: invoice PDF, email, push, exports, low-stock/expiry digests, report materialisation, Razorpay webhook processing (idempotent), data-retention purge. Dead-letter queue + alerts.

## 12. Reporting performance
Operational queries on OLTP with proper indexes; heavy aggregates via daily/hourly summary tables (`sales_daily(tenant, branch, date, …)`) updated incrementally by worker; read replica when needed. All report queries pass through the same permission layer.

## 13. Environments & delivery
**Only two environments: `dev` (local) and `prod`.** There is no staging. Because prod has no rehearsal environment, risky changes use feature flags, backward-compatible migrations and a tested rollback, and are tried locally with realistic seed data before release.
**Now:** local only (docker-compose: pg, redis, minio, mailpit). Optional lightweight GitHub Actions per repo (lint, typecheck, tests, secret scan). **Deployment is deferred** by the owner; when decided, target AWS Mumbai at ~US$150/month (single small ECS task, small RDS with backups, S3, CloudFront; scale up later) via Terraform. DB migrations stay backward compatible (expand → migrate → contract). Mobile release is manual.

## 14. Key ADRs to write in Phase 0
ADR-001 modular monolith • ADR-002 Prisma + RLS (decided: Prisma; per-request interactive transaction with `set_config('app.tenant_id', …, true)`; global client banned in request paths) • ADR-003 RLS strategy • ADR-004 money as paise • ADR-005 offline sync • ADR-006 auth/session design • ADR-007 costing engine • ADR-008 PDF rendering.
