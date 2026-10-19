# dumbbill-backend

The API for Dumbbill. NestJS 11 · TypeScript · Prisma 6 · PostgreSQL 16 · Redis · class-validator · Pino · Swagger · Jest.

Rules for contributors and the AI assistant: `CLAUDE.md`. Planning docs live in `../docs`.

## Quick start

```bash
pnpm install              # installs packages, generates the Prisma client
docker compose up -d      # PostgreSQL, Redis, Mailpit
pnpm db:migrate           # create the restricted database role, then the tables
pnpm db:seed              # load reference data
pnpm dev                  # http://localhost:3000
```

The first time, make sure a `.env` file exists: copy `.env.example` (`cp .env.example .env` in Git Bash, `copy .env.example .env` in PowerShell). The defaults work as-is with the Docker services.

## URLs

| URL | Purpose |
|---|---|
| `/docs` | Swagger UI, the API manual for web and mobile developers |
| `/docs-json` | The raw OpenAPI file |
| `/healthz` | Liveness: is the process alive |
| `/readyz` | Readiness: can it reach PostgreSQL |
| http://localhost:8025 | Mailpit inbox for development emails |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start with auto-reload |
| `pnpm build` / `pnpm start` | Compile to `dist/` and run it |
| `pnpm lint` | Check code style and mistakes (the same check runs on every commit) |
| `pnpm typecheck` | Check TypeScript types |
| `pnpm test` | Unit tests (fast, no database) |
| `pnpm test:int` | Integration tests, including tenant isolation against a real PostgreSQL (needs `docker compose up -d`) |
| `pnpm test:sec` | Security suites. Today: the row-level-security coverage audit. IDOR sweep, RBAC matrix and cashier-leak scan are added from Phase 1 |
| `pnpm db:roles` | Create or refresh the restricted `dumbbill_app` database role (safe to repeat) |
| `pnpm db:migrate` | Runs `db:roles`, then creates and applies a migration after editing `prisma/schema.prisma`. Extra arguments go to Prisma, for example `--name add_products` |
| `pnpm db:deploy` | Runs `db:roles`, then applies existing migrations only (use this on servers) |
| `pnpm db:status` | Show which migrations are applied |
| `pnpm db:seed` | Load reference data (safe to repeat) |
| `pnpm db:seed:demo` | Reference data plus demo data (local database only) |
| `pnpm db:seed:list` | List the available seeders |
| `pnpm db:reset` | **Delete everything** in the local database, re-migrate and re-seed |
| `pnpm db:studio` | Browse the database in a web page |
| `pnpm keys:generate` | Print fresh production secrets (token signing key, encryption key, password pepper). Writes nothing to disk |
| `pnpm docs:errors` | Regenerate `docs/api/error-codes.md` from the error catalogue (run after adding an error code) |

## Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3000` | API port |
| `BRAND_NAME` | `Dumbbill` | Product name used in emails and docs |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` |
| `APP_DATABASE_URL` | none (required) | The connection the running API uses: the restricted `dumbbill_app` role, which cannot bypass row-level security |
| `DATABASE_URL` | none (tooling only) | The owner connection used for migrations, seeds and role setup. The running API does not need it, so production servers can leave it unset |
| `REDIS_URL` | none (required) | Redis connection string |
| `SENTRY_DSN` | empty | Error tracking address. Empty turns it off |
| `APP_VERSION` | `dev` | Written on every log line and Sentry report. Set it to the release when deploying |
| `OTEL_EXPORTER` | `none` | Tracing: `none` or `console` (print every step of a request to the terminal) |
| `STORAGE_DRIVER` | `local` | Where uploads go. Only `local` (server disk) exists today |
| `STORAGE_LOCAL_DIR` | `./storage` | Upload folder. Back it up with the database |
| `STORAGE_MAX_FILE_MB` | `5` | Largest accepted upload |
| `WEB_BASE_URL` | `http://localhost:3001` | The web app's address, used for the links in emails. Must be `https` in production |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3001` | Browser origins allowed to call the API (comma separated, never `*`) |
| `COOKIE_DOMAIN` | empty | Shared parent domain for the sign-in cookies in production (for example `.dumbbill.in`) |
| `TRUST_PROXY_HOPS` | `0` | How many proxies sit in front of the API. Set exactly: it decides which IP address is trusted by rate limits |
| `JWT_PRIVATE_KEY`, `JWT_KEY_ID` | empty, `dev` | Signs access tokens. **Required in production** (`pnpm keys:generate`); in development a throw-away key is used |
| `JWT_PREVIOUS_PUBLIC_KEYS` | empty | Old public keys still accepted during a key rotation |
| `PASSWORD_PEPPERS` | empty | Versioned server-side password secret. **Required in production** |
| `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST` | `65536`, `3` | Password hashing strength. Production refuses less than 19456 KiB |
| `RATE_LIMIT_DISABLED` | `false` | **Development only.** `true` switches off all rate limits and the wrong-password lockout. Production refuses to start with it on |
| `PASSWORD_BREACH_CHECK` | `true` | Refuse passwords found in known data breaches |
| `DATA_ENCRYPTION_KEY` | empty | Encrypts authenticator-app secrets. **Required in production** |
| `MAIL_SMTP_URL`, `MAIL_FROM` | Mailpit, `Dumbbill <no-reply@dumbbill.local>` | Outgoing email. Production: the Amazon SES SMTP endpoint |

If a setting is wrong the app refuses to start and lists every problem. **In production the app also refuses to start with development shortcuts** (missing signing key, pepper or encryption key, a weak hashing setting, a non-https web address, a wildcard CORS origin).

## Code map

```
src/
  main.ts, app.module.ts, app.setup.ts, swagger.ts     start-up and global setup
  config/env.validation.ts                             typed, validated settings
  common/logging/                                      logger setup and secret redaction
  common/request-context/                              request ids (X-Request-Id) and per-request context
  common/errors/                                       error catalogue, DomainError, standard error body, global filter
  common/swagger/                                      @ApiProblemResponse and the error body schema
  observability/                                       Sentry and OpenTelemetry tracing
  modules/
    health/                                            /healthz, /readyz
    prisma/                                            database client (restricted app role)
    tenancy/                                           TenantTx: tenant-locked transactions
    storage/                                           file storage (local disk)
    auth/                                              sign-up, sign-in, sessions, two-step login (see docs/api/auth-flow.md)
    permissions/                                       permission catalogue (permissions.matrix.ts), @Permission, the global guard, branch scope
    team/                                              roles, members, invitations, approval PIN (see docs/api/team-and-permissions.md)
    business/                                          business profile, GSTIN rules, branches, first-steps checklist (see docs/api/business-and-branches.md)
    catalogue/                                         products, categories, price history, pictures, CSV import (see docs/api/catalogue.md)
    audit/                                             append-only audit log writer
    mail/                                              outgoing email (SMTP) and the account email texts
prisma/
  schema.prisma                                        tables
  migrations/                                          history of schema changes (commit these)
  seed/                                                seed system (data/, seeders/, runner, safety rules)
scripts/                                               helper scripts (role setup, safety checks)
test/{unit,integration,security}/                      tests by kind
```

Each feature module will follow `controller -> service -> domain -> repository` (see `CLAUDE.md`).

## Signing in

The Auth endpoints (`/v1/auth/...`) are documented in Swagger and, for web and mobile developers, in `docs/api/auth-flow.md`. To try them locally: start Docker and the API, run `pnpm db:seed` once (a business needs the Starter plan), sign up through `/docs`, then open Mailpit at http://localhost:8025 to read the verification email.

**Every route must declare who may call it**: `@Public()`, `@Authenticated()` (any signed-in person, own account) or `@Permission('products.write')`. A route that declares nothing is refused for everyone and fails `pnpm test:int` (the route-by-role matrix test). The permission names live in one file, `src/modules/permissions/permissions.matrix.ts`; the Swagger description must carry a matching `Permission:` line. See `docs/api/team-and-permissions.md`.

## Good to know

- **Versions are pinned for compatibility.** NestJS 11 (v12 is ESM-only and breaks Jest on Node 22) and TypeScript 5.9 (typescript-eslint and ts-jest do not support TypeScript 7 yet). Do not upgrade them without checking.
- **The Prisma `package.json#prisma` warning** is expected on Prisma 6; it will move to `prisma.config.ts` when upgrading to Prisma 7.
- **Every response has an `X-Request-Id` header; every error has a `requestId`.** Quote it when asking for help; it finds the full story in the logs. Guide: `../docs/runbooks/logging-and-errors.md`.
- **Tenant data is protected by the database itself.** Business code must use `TenantTx`, never `PrismaService` (a lint rule enforces this). Why and how: `../docs/adr/002-prisma-rls.md`.
- **Uploads have no HTTP endpoint yet.** Storage is built and tested; the upload and download routes are added in Phase 1 together with login and permissions, because an upload route without authentication would be a security hole.
- **Commits** must follow Conventional Commits (`feat: add branch list`). A hook checks this.

More detail: `../docs/runbooks/`.
