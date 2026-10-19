# dumbbill-backend – Rules

NestJS (TypeScript strict) · Prisma · PostgreSQL (RLS) · class-validator · BullMQ/Redis · Pino · Argon2 · `@nestjs/swagger` · Jest + Supertest (real Postgres from docker compose, throwaway database per test file).
Read `../CLAUDE.md`, `../docs/03-engineering/{architecture,security,standards,observability,api-docs-standard}.md`.

## Structure
`src/modules/<module>/{controller,service,dto,domain,repository}` · `src/common/{guards,interceptors,filters,logging}` · `prisma/{schema.prisma,migrations,sql/rls}` · `test/{unit,integration,security}`.
Layers: controller (HTTP only) → service (use case) → domain (pure functions: pricing, tax, WAC, loyalty) → repository (Prisma).

## Prisma + RLS (critical). Full reasoning: `../docs/adr/002-prisma-rls.md`
- Two database connections: `DATABASE_URL` is the **owner** (migrations, seeds; tooling only) and `APP_DATABASE_URL` is the restricted **`dumbbill_app`** role the API runs as (no superuser, **NOBYPASSRLS**, cannot change structure). Never point the API at the owner.
- **Business code reaches the database only through `TenantTx`**: `this.tenantTx.run(tx => tx.product.findMany())`. It opens a transaction and sets `app.tenant_id` / `app.user_id` with `set_config(..., true)` (transaction-local, so nothing leaks between pooled requests). Use `runAs({ tenantId }, ...)` only in jobs, webhooks and tests.
- **Never inject or import `PrismaService` in business code** and never `new PrismaClient()` in `src/`. ESLint blocks it (allowed only in `modules/prisma`, `modules/tenancy` and the health probe). Do not use plain `SET` or session-level `set_config`.
- **New tenant table checklist:** `tenantId` column with `@map("tenant_id") @db.Uuid`, index starting with `tenant_id`, `@default(uuid(7))` id; then append `SELECT enable_tenant_rls('<table>'); SELECT app_grant_defaults();` to its migration (append-only tables also `REVOKE UPDATE, DELETE ... FROM dumbbill_app`). `pnpm test:sec` fails and names the table if anything is missing.
- RLS and grants live in the migrations (SQL functions `enable_tenant_rls`, `app_grant_defaults`, `app_current_tenant_id`); roles are created by `scripts/setup-db-roles.mjs` (`pnpm db:roles`, run automatically by `db:migrate` and `db:deploy`).
- Tests run against a real PostgreSQL (the docker compose one) in a **throwaway database per test file** (`test/support/test-database.ts`). Never mock the database for security tests.
- Dev owner is a superuser and bypasses RLS: always test as `dumbbill_app`.

## Authentication (P1-1). Full reasoning: `../docs/adr/006-auth-and-sessions.md`; app guide: `../docs/api/auth-flow.md`
- **Deny by default:** a global `AuthGuard` protects every route. Open a route only with `@Public()` and write `Permission: public` in its Swagger description. Protected routes get the signed-in user with `@CurrentUser()`; never read ids for the tenant or user from the request body.
- **`TenantTx.runAs()` sets the in-process tenant context too**, so code inside it (the audit writer, the logger) knows the business. Signup, login and job code use `runAs`; request code uses `run`.
- **Tokens:** access token = 15-minute EdDSA JWT with audience `dumbbill-staff` (customers get their own audience in Phase 3). Refresh and emailed tokens are `<tenantId>.<secret>`, only SHA-256 hashes stored, used once. Never log or return a token hash, password hash or TOTP secret; response DTOs are separate classes for that reason.
- **Anything a stranger can reach must answer the same for known and unknown emails** (status, code, text) and be rate limited. Use `RateLimiter` and `DomainError` with a `Retry-After` header.
- **Append-only tables** (audit_log now; stock_ledger and points_ledger later): add the table to the `append_only` list in `app_grant_defaults()` in its migration, or the next migration's grants reopen it.
- **Audit sensitive events** with `AuditService.write(tx, event, info)` INSIDE the transaction that does the work. No secrets in `metadata`.
- Production refuses to start without real secrets (`pnpm keys:generate`); development uses throw-away values and logs a warning.
- Sign-in tests use `test/support/auth-test-app.ts` (real app and database; fake clock, Redis, mail and breach check). Move time with `clock.advanceSeconds()`, give each caller a `freshIp()`, and read emails from `mailer`.

## Permissions and the team (P1-2). Reasoning: `../docs/adr/009-roles-and-permissions.md`; app guide: `../docs/api/team-and-permissions.md`
- **Every route declares exactly one of** `@Public()`, `@Authenticated()` or `@Permission('area.action', ...)` (all listed permissions are required). Nothing declared = refused for everyone and the build fails (`test/integration/permission-matrix.spec.ts`, generated from the real routes). The Swagger `Permission:` line must match; the test checks it.
- **Permission names exist in ONE place**: `src/modules/permissions/permissions.matrix.ts`. Never type a permission string anywhere else; never write `if (role === 'admin')`. To add a capability, add one line to the catalogue (and decide which built-in roles get it in `ROLE_PRESETS`).
- A person's access is **re-read on every request** (`AccessService`); the controller gets it as `request.access` (`LoadedAccess`). Do not copy permissions into tokens or caches.
- **Cashier-leak rule:** a cashier-style role must never hold a `confidential` permission (`products.cost.read`, `reports.profit`). A new permission that reveals cost or profit must be marked `confidential: true`.
- **Hand-out rules** live in `RolesService` and `MembersService`: nobody grants what they do not hold, nobody edits themselves, nobody edits the owner. Any new endpoint that changes someone's access must reuse them.
- **Branches:** filter lists with `BranchScope.filter()`, check one item with `BranchScope.assert(branchId)`, or mark the route `@BranchScoped({ param })`. Row-level security only separates businesses.
- Audit every team change with `AuditService.write` inside the transaction; refusals are audited by the guard (`authz.denied`).
- Team and permission tests use `test/support/team-helpers.ts` (`createBusiness`, `addTeamMember`, `as(person).get(...)`). Run integration tests with `--runInBand` (`pnpm test:int` does): files share one database server, and parallel runs race on role creation.

## Business profile and branches (P1-3). Reasoning: `../docs/adr/010-business-profile-and-branches.md`; app guide: `../docs/api/business-and-branches.md`
- **GSTIN rules live in one pure file**, `src/modules/business/domain/gstin.ts` (shape, check character). State and PAN agreement are checked by `place-rules.ts` for the business AND every branch; the database has matching `CHECK` constraints. Never validate a GSTIN anywhere else.
- **Reading needs a login, changing needs `settings.manage`.** Branch lists are filtered by `BranchScope`; a branch of another business is a 404.
- **The plan limit counts ACTIVE branches** (`BranchesService.assertRoomForAnother`, `PLAN_LIMIT_REACHED`). Branches are switched off, never deleted; the last active branch cannot be switched off.
- **Invoice prefixes are unique per business.** Check for the clash first so the error names the field (`errors[]` on a `CONFLICT`); the unique index is the safety net for two simultaneous requests.
- **Logo files** go through `FileStorage` under the business's own folder with a random name; only PNG, JPEG, WebP; the service ignores any client file name.
- Business and branch tests: `test/integration/business-flow.spec.ts` (uses a second `GROWTH` plan to allow several branches), `test/security/business-db-security.spec.ts`. The test app seeds the real GST state list.

## Catalogue and pricing (P1-4). Reasoning: `../docs/adr/011-catalogue-and-pricing.md`; app guide: `../docs/api/catalogue.md`
- **Cost secrecy is a TYPE decision.** `ProductCashierDto` has no cost, margin or profit field; `ProductAdminDto` adds them and is returned only when the caller holds `products.cost.read` (`describeMany` in `products.service.ts`). Never add a cost-like field to the cashier type, never put cost in an audit `metadata` or a log (record field NAMES only), and make any new product endpoint go through `describeMany`. `test/integration/catalogue-flow.spec.ts` (the leak scanner) fails the build otherwise.
- **A price is never edited.** There is no price column on `products`; prices live in the append-only `price_history` (app role has no UPDATE/DELETE, a trigger refuses everyone). The price in force = newest row with `effective_from <= now` (read through the injected `Clock`, so tests can move time). New price rows come only from `changePrice` (reason required, no start in the past, price not above MRP) and from creation and import ("Initial price").
- **Tax rules live in one place each:** GST rates in `domain/gst-rates.ts` (the CA owns that list), field rules in `domain/product-rules.ts` (used by the API AND the CSV import), rupee text in `domain/money.ts`.
- **Pictures** go through `images/product-images.ts` (decode, re-encode, size cap) and `FileStorage`; the storage key always comes from the business's own row, never from a request.
- **Uniqueness:** check first (`assertUnique`) so the error names the field; the unique indexes are the safety net.
- New append-only table? Add it to `append_only` inside `app_grant_defaults()` in its migration (price_history is there now).

## DTOs & docs
- class-validator + class-transformer with `whitelist: true, forbidNonWhitelisted: true`.
- Separate response DTO classes per audience (`ProductCashierDto` vs `ProductAdminDto`). Never return Prisma entities.
- Every endpoint: `@ApiTags`, `@ApiOperation` (summary + description), `@ApiBearerAuth`, all request examples, `@ApiResponse` for every success and error code with example bodies, permission noted. Errors follow RFC 9457 problem+json with stable `code`.

## Errors, logging and tracing (details: `../docs/runbooks/logging-and-errors.md`)
- Throw `DomainError('<CODE>', 'helpful detail')` for problems the caller can fix; codes live in `src/common/errors/error-codes.ts` (add a line there, then `pnpm docs:errors` and commit `docs/api/error-codes.md`). Let real bugs throw normally: the global filter turns them into a safe 500, logs the stack and reports to Sentry.
- Never put secrets or customer data in an error message: messages are logged unscrubbed.
- Log with the injected nestjs-pino `Logger`, putting the message INSIDE the object: `this.logger.log({ msg: 'Invoice created', invoiceId })`. Never `console.log`. Do not log request bodies. Redaction is a safety net, not permission.
- Every endpoint documents its errors with `@ApiProblemResponse('<CODE>', ...)`; `test/integration/swagger-completeness.spec.ts` fails if any route lacks tags, a unique operationId, summary, a `Permission:` line in the description, a success response, or the errors required for its kind.
- Response header `X-Request-Id` and body `requestId` are set automatically; do not invent other ids.

## Must-have tests
IDOR sweep over all routes, RBAC matrix, cashier-leak scanner, idempotency, stock concurrency, loyalty race, money property tests. Already in place: log redaction, error contract, Swagger completeness, RLS coverage, tenant isolation.

## Comments (mandatory)
Follow the "Comments" section of `../CLAUDE.md`: file purpose, a doc comment on every exported symbol, and the *why* behind business rules, security choices and non-obvious code, in plain English.
