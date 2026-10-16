# API Documentation Standard (Swagger / OpenAPI)

The backend's Swagger UI at `/docs` (and `/docs-json`) is the contract the web and mobile developers integrate against. It must be complete enough that someone can build a screen without asking the backend developer.

## 1. Global
- OpenAPI 3.1 via `@nestjs/swagger`. Title, version, description (auth model, tenancy, money-in-paise, time-in-UTC, pagination, idempotency, rate limits, error format), servers (local dev and prod), contact.
- **Tags/sections** (in this order): Auth · Tenants & Business · Branches · Team & Permissions · Products · Pricing · Suppliers · Purchases · Inventory · POS & Invoices · Discount Approvals · Shifts · Tax · Loyalty (staff) · Customer App · Reports · Billing & Plans · Notifications · Files · Audit · Super Admin · System.
- Security schemes: `staff-bearer`, `customer-bearer`, `public-invoice-token`. Each operation declares which applies.
- Customer/staff and cashier/admin responses are separate schemas with distinct names.

## 2. Every operation must include
1. `summary` (≤ 8 words) and `description` (purpose, business rules, side effects, who can call it).
2. **Required permission key** and branch-scope rule, rendered in the description (`Permission: pos.sell · Scope: assigned branch`).
3. Request: path/query/body schemas with `description`, `example`, constraints (min/max/pattern/enum) on every field; units stated (paise, grams).
4. Headers: `Idempotency-Key` where required; `If-Match` for updates.
5. **Success responses** with realistic example bodies (Indian data, paise values explained).
6. **Error responses** for every applicable status: 400 validation (with `errors[]` example), 401, 403, 404, 409 (conflict/idempotency), 422 (business rule, with stable `code` e.g. `DISCOUNT_EXCEEDS_LIMIT`), 429 (rate limit + `Retry-After`), 500. Each with a problem+json example.
7. Pagination (`cursor`, `limit`, `nextCursor`) and filters documented.
8. `operationId` in `verbNoun` form (`createInvoice`), stable once published. Deprecations marked with sunset date.

## 3. Error contract (RFC 9457)
```json
{ "type": "https://api.dumbbill.in/errors/discount-exceeds-limit",
  "title": "Discount exceeds your limit", "status": 422,
  "code": "DISCOUNT_EXCEEDS_LIMIT", "detail": "Maximum allowed is 5%.",
  "requestId": "01JA…", "errors": [{ "field": "discount.value", "message": "Must be ≤ 5" }] }
```
A central **error-code catalogue** (`docs/api/error-codes.md`, generated) lists every `code` with meaning and suggested UI handling.

## 4. Integration guides (written in Swagger description or `docs/api/`)
Auth & refresh flow • Checkout sequence (quote → approval → create invoice → print/share) • Offline sync protocol • Loyalty join and redeem • Pagination & filtering • File upload (presigned) • Webhooks (Razorpay, internal) • Versioning and breaking-change policy.

## 5. Enforcement
- CI test fails if any route lacks `@ApiOperation`, `@ApiTags`, a success `@ApiResponse`, documented error responses, or a permission annotation.
- Snapshot of `openapi.json` committed; a diff check flags breaking changes (removed field, narrowed enum, new required field) for review.
- Examples are validated against their schemas in a test.
