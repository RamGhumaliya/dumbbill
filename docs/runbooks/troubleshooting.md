# Troubleshooting

Find your message, apply the fix.

| Symptom | Cause | Fix |
|---|---|---|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop is not running | Start Docker Desktop, wait until it is ready, retry `docker compose up -d` |
| `TLS handshake timeout` while pulling images | Flaky internet | Run `docker compose up -d` again; layers already downloaded are kept |
| `Invalid environment configuration: ...` on start | A setting in `.env` is missing or wrong | The message lists each bad variable. Compare with `.env.example` |
| `@prisma/client did not initialize yet` | Prisma client was not generated, often after reinstalling packages | `pnpm db:generate` |
| `Can't reach database server at localhost:5432` | PostgreSQL container is not running | `docker compose up -d`, then `docker compose ps` |
| `Port 3000 is already in use` | Another program uses it | Stop it, or change `PORT` in `.env` |
| `Port 5432 is already allocated` | A local PostgreSQL install uses the port | Stop that service, or change the port mapping in `docker-compose.yml` and `DATABASE_URL` |
| `Ignored build scripts` from pnpm | pnpm blocks install scripts until approved | `pnpm approve-builds`, allow Prisma packages |
| `typescript-eslint does not support TS 7` or ts-jest error about TypeScript | TypeScript 7 got installed | Keep `typescript` at `~5.9` (see README, "Good to know") |
| Jest: `ESM syntax ... could not be executed as CommonJS` | NestJS 12 (ESM-only) got installed | Keep `@nestjs/*` at `^11` |
| Commit rejected by commitlint | Message is not Conventional Commits | Use `type: message`, for example `feat: add product list`. Types: feat, fix, docs, chore, refactor, test |
| `Refusing to run: this command deletes all data ...` | `pnpm db:reset` safety check | Working as intended: the environment is production or the database is not local |
| `Refusing to seed "demo" data` | Demo seed safety check | Same: demo data is local-only |
| `Prisma Migrate detected that it was invoked by Claude Code` | Prisma blocks AI tools from destructive resets | Run `pnpm db:reset` yourself in a terminal |
| Queries return nothing / `new row violates row-level security policy` | The query ran without a tenant, or tried to write into another business | Business code must use `tenantTx.run(...)` (inside an authenticated request) or `runAs({ tenantId }, ...)` (jobs, tests). This protection is working as designed |
| `TenantTx.run() called outside a tenant context` | Code ran before the request was authenticated, or in a background job | Authenticate first, or use `runAs({ tenantId }, ...)` in jobs |
| `permission denied for table ...` when running the API | The table has no grants for the app role | Add `SELECT app_grant_defaults();` to that table's migration (run `pnpm db:roles` once for existing databases); `pnpm test:sec` catches this |
| `password authentication failed for user "dumbbill_app"` | The app role does not exist or its password differs from `APP_DATABASE_URL` | Run `pnpm db:roles` |
| `APP_DATABASE_URL ... must use a different user than DATABASE_URL` | The app was pointed at the owner | Use the `dumbbill_app` user in `APP_DATABASE_URL` |
| ESLint: `Do not use PrismaService in business code` | A module imports the raw database client | Inject `TenantTx` and use `tenantTx.run(tx => ...)` |
| Integration/security tests fail to start with `connect ECONNREFUSED` | PostgreSQL is not running | `docker compose up -d` |
| Swagger completeness test fails naming a route | The route is missing tags, an operationId, a `Permission:` line, a success response or documented errors | Read the message (it lists each missing piece) and fix with `@ApiTags`, `@ApiOperation`, `@ApiOkResponse`, `@ApiProblemResponse`. See `docs/03-engineering/api-docs-standard.md` |
| `error-codes.md is up to date` test fails | An error code was added or changed without regenerating the doc | `pnpm docs:errors`, then commit `docs/api/error-codes.md` |
| My log message shows as `context` / the message is missing | The Nest logger treats a trailing text argument as a context | Put the message in the object: `logger.log({ msg: 'text', ...fields })` |
| A field is shown as `[redacted]` in logs | Its name matches the secret list (password, token, pin, cost, profit ...) | Working as designed. Log a different field name if you really need the value, but never secrets |
| Want to see why a request is slow | Tracing is off by default | Set `OTEL_EXPORTER=console` in `.env`, restart, repeat the request |
| Uploaded file rejected with `CONTENT_MISMATCH` | File bytes do not match its type | Check the file is a real image or PDF, not renamed |
| Emails not arriving | Development emails are not delivered anywhere | Open http://localhost:8025 (Mailpit) |

## Useful checks

```bash
docker compose ps                          # are the services up?
docker compose logs postgres --tail 50     # database logs
docker compose exec postgres psql -U dumbbill -d dumbbill     # open a SQL prompt
curl http://localhost:3000/readyz          # can the API reach the database?
pnpm db:status                             # are migrations applied?
```

## Starting completely fresh (local only, destroys local data)

```bash
docker compose down -v      # removes containers AND database data
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

## Still stuck?

Quote the `requestId` from the error response (or the log line) when asking for help; it ties together everything that happened in that request.
