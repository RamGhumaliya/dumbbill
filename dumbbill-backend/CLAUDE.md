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

## DTOs & docs
- class-validator + class-transformer with `whitelist: true, forbidNonWhitelisted: true`.
- Separate response DTO classes per audience (`ProductCashierDto` vs `ProductAdminDto`). Never return Prisma entities.
- Every endpoint: `@ApiTags`, `@ApiOperation` (summary + description), `@ApiBearerAuth`, all request examples, `@ApiResponse` for every success and error code with example bodies, permission noted. Errors follow RFC 9457 problem+json with stable `code`.

## Must-have tests
IDOR sweep over all routes, RBAC matrix, cashier-leak scanner, idempotency, stock concurrency, loyalty race, money property tests, log redaction.

## Comments (mandatory)
Follow the "Comments" section of `../CLAUDE.md`: file purpose, a doc comment on every exported symbol, and the *why* behind business rules, security choices and non-obvious code, in plain English.
