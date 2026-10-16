# dumbbill-backend – Rules

NestJS (TypeScript strict) · Prisma · PostgreSQL (RLS) · class-validator · BullMQ/Redis · Pino · Argon2 · `@nestjs/swagger` · Jest + Supertest + Testcontainers.
Read `../CLAUDE.md`, `../docs/03-engineering/{architecture,security,standards,observability,api-docs-standard}.md`.

## Structure
`src/modules/<module>/{controller,service,dto,domain,repository}` · `src/common/{guards,interceptors,filters,logging}` · `prisma/{schema.prisma,migrations,sql/rls}` · `test/{unit,integration,security}`.
Layers: controller (HTTP only) → service (use case) → domain (pure functions: pricing, tax, WAC, loyalty) → repository (Prisma).

## Prisma + RLS (critical)
- App connects as `app_user` (no BYPASSRLS, not table owner). Migrations run as a separate owner role.
- Every request runs inside `prisma.$transaction(async tx => { await tx.$executeRaw\`SELECT set_config('app.tenant_id', ${tenantId}, true)\`; ... })` through a single `TenantTx` helper. Services receive `tx`; **never** call the global `prisma` client in request paths (lint rule).
- RLS SQL lives in `prisma/sql/rls/*.sql`, applied by migrations. A generated test asserts every `tenant_id` table has RLS ENABLE+FORCE+policy.
- Append-only tables (`audit_log`, `stock_ledger`, `points_ledger`) have UPDATE/DELETE revoked.

## DTOs & docs
- class-validator + class-transformer with `whitelist: true, forbidNonWhitelisted: true`.
- Separate response DTO classes per audience (`ProductCashierDto` vs `ProductAdminDto`). Never return Prisma entities.
- Every endpoint: `@ApiTags`, `@ApiOperation` (summary + description), `@ApiBearerAuth`, all request examples, `@ApiResponse` for every success and error code with example bodies, permission noted. Errors follow RFC 9457 problem+json with stable `code`.

## Must-have tests
IDOR sweep over all routes, RBAC matrix, cashier-leak scanner, idempotency, stock concurrency, loyalty race, money property tests, log redaction.

## Comments (mandatory)
Follow the "Comments" section of `../CLAUDE.md`: file purpose, a doc comment on every exported symbol, and the *why* behind business rules, security choices and non-obvious code, in plain English.
