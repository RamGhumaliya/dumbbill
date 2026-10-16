# dumbbill-backend

The API for Dumbbill. NestJS 11 · TypeScript · Prisma 6 · PostgreSQL 16 · Redis · class-validator · Pino · Swagger · Jest.

Rules for contributors and the AI assistant: `CLAUDE.md`. Planning docs live in `../docs`.

## Quick start

```bash
pnpm install              # installs packages, generates the Prisma client
docker compose up -d      # PostgreSQL, Redis, Mailpit
pnpm db:migrate           # create tables
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
| `pnpm test:int` | Integration tests |
| `pnpm test:sec` | Security suites (added from Phase 1) |
| `pnpm db:migrate` | Create and apply a migration after editing `prisma/schema.prisma` |
| `pnpm db:deploy` | Apply existing migrations only (use this on servers) |
| `pnpm db:status` | Show which migrations are applied |
| `pnpm db:seed` | Load reference data (safe to repeat) |
| `pnpm db:seed:demo` | Reference data plus demo data (local database only) |
| `pnpm db:seed:list` | List the available seeders |
| `pnpm db:reset` | **Delete everything** in the local database, re-migrate and re-seed |
| `pnpm db:studio` | Browse the database in a web page |

## Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3000` | API port |
| `BRAND_NAME` | `Dumbbill` | Product name used in emails and docs |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` |
| `DATABASE_URL` | none (required) | PostgreSQL connection string |
| `REDIS_URL` | none (required) | Redis connection string |
| `SENTRY_DSN` | empty | Error tracking address. Empty turns it off |
| `STORAGE_DRIVER` | `local` | Where uploads go. Only `local` (server disk) exists today |
| `STORAGE_LOCAL_DIR` | `./storage` | Upload folder. Back it up with the database |
| `STORAGE_MAX_FILE_MB` | `5` | Largest accepted upload |

If a setting is wrong the app refuses to start and lists every problem.

## Code map

```
src/
  main.ts, app.module.ts, app.setup.ts, swagger.ts     start-up and global setup
  config/env.validation.ts                             typed, validated settings
  common/logging/                                      logger setup
  modules/
    health/                                            /healthz, /readyz
    prisma/                                            database client
    storage/                                           file storage (local disk)
prisma/
  schema.prisma                                        tables
  migrations/                                          history of schema changes (commit these)
  seed/                                                seed system (data/, seeders/, runner, safety rules)
scripts/                                               helper scripts
test/{unit,integration,security}/                      tests by kind
```

Each feature module will follow `controller -> service -> domain -> repository` (see `CLAUDE.md`).

## Good to know

- **Versions are pinned for compatibility.** NestJS 11 (v12 is ESM-only and breaks Jest on Node 22) and TypeScript 5.9 (typescript-eslint and ts-jest do not support TypeScript 7 yet). Do not upgrade them without checking.
- **The Prisma `package.json#prisma` warning** is expected on Prisma 6; it will move to `prisma.config.ts` when upgrading to Prisma 7.
- **Uploads have no HTTP endpoint yet.** Storage is built and tested; the upload and download routes are added in Phase 1 together with login and permissions, because an upload route without authentication would be a security hole.
- **Commits** must follow Conventional Commits (`feat: add branch list`). A hook checks this.

More detail: `../docs/runbooks/`.
