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
| Web: `Invalid environment configuration ... NEXT_PUBLIC_API_BASE_URL` on dev, build or start | The web app has no `.env.development` / `.env.production` | Copy the matching `.example` file (see `dumbbill-web/README.md`). `pnpm build` reads `.env.production` |
| Web: owner dashboard says "Cannot reach the server" | The API is not running, or `NEXT_PUBLIC_API_BASE_URL` points elsewhere | Start the API (`docker compose up -d`, `pnpm dev` in dumbbill-backend), then reload. The reference shown matches the request in the API logs |
| Sign-up fails with a 500 and the log says `Reference data missing: run pnpm db:seed` | The Starter plan is not in the database | `pnpm db:seed` in `dumbbill-backend` |
| No verification or reset email arrives | Mailpit is not running, or you are looking in the wrong place | `docker compose up -d`, then open http://localhost:8025. Nothing is sent to real inboxes in development |
| Verification link says "invalid or expired" | It was already used, replaced by a newer email, or older than 24 hours (reset links: 30 minutes) | Use "Resend" and click the newest email |
| Login answers 429 "Too many attempts" | 5 wrong passwords lock the account for 1 minute, doubling to 15; or one address made more than 30 attempts a minute | Wait for the `Retry-After` seconds. To clear it in development: `docker compose exec redis redis-cli FLUSHDB`, or set `RATE_LIMIT_DISABLED=true` in `dumbbill-backend/.env` and restart the API (development only; production refuses to start with it) |
| Everyone is rate limited at once behind a proxy or load balancer | The API sees the proxy's address for every visitor | Set `TRUST_PROXY_HOPS` to the exact number of proxies in front of the API |
| Production start-up lists `JWT_PRIVATE_KEY is required ...` | Production refuses development shortcuts | `pnpm keys:generate` and put the values in the server's environment |
| `Reuse of a refresh token` in the logs, or users logged out suddenly | A refresh token was used twice more than 10 seconds apart (a stolen copy, or an app that does not store the NEW token from each refresh) | Check the client stores the new refresh token before doing anything else; see `docs/api/auth-flow.md` |
| Browser refresh answers `CSRF_FAILED` | The `X-CSRF-Token` header is missing or differs from the `dumbbill_csrf` cookie | Send the cookie's value as the header; web app and API must share a site (`COOKIE_DOMAIN`) |
| Mobile: errors about missing `*.g.dart` / `*.freezed.dart` files | Generated code is not committed | `dart run build_runner build` in `dumbbill-mobile` |
| Mobile: `Could not close incremental caches` during an Android build | Kotlin cannot relate project paths on D: to the pub cache on C: | Keep `kotlin.incremental=false` in `android/gradle.properties` |
| Mobile: `The plugin sentry_flutter requires a higher Android SDK version` | minSdk is below 26 | Keep `minSdk` at 26 or more in `android/app/build.gradle.kts` |
| Mobile: emulator exits at start with `Broken AVD system path` | The emulator was created for a system image you no longer have | Create a new emulator in Android Studio Device Manager with an installed image |
| Mobile: home screen says "Cannot reach the server" | API not running, or wrong `API_BASE_URL` | Start the API; emulator uses `http://10.0.2.2:3000`, a real phone needs your computer's wifi address (see `dumbbill-mobile/config/README.md`) |
| Mobile: `flutter test` says the generated tokens are out of date | `tokens.json` changed | `dart run tool/generate_tokens.dart` in `dumbbill-mobile`, then commit the result |
| Web: console says "violates the following Content Security Policy" | Something loads a script or style the strict policy does not allow | Do not loosen the policy. Fix the code (no inline scripts, no third-party scripts). The policy is built in `src/lib/security/csp.ts` |
| Web: `pnpm test:e2e` cannot find a browser | Chromium for tests is not installed | `pnpm exec playwright install chromium` |
| Web: accessibility test fails with `color-contrast` | A colour pair is below the 4.5:1 minimum | Adjust the token in `src/styles/tokens.css` (and the design guide), not the test |
| Web: `pnpm tokens` says "Design tokens are not valid" | A colour pair in `tokens.json` is below its WCAG contrast minimum, a role is missing in a theme, or a new role has no contrast check | Read the listed line (it names the pair and the ratio) and fix the colour. Do not lower the minimum |
| Web: test says a generated file "is out of date" | `tokens.json` was edited without regenerating | `pnpm tokens`, then commit the generated files |
| Web: lint says "Raw colour" or "Arbitrary Tailwind size" | Code uses `#hex`, `w-[13px]` or `12px` | Use a token class (`bg-surface`, `p-3`, `min-h-(--size-control-md)`). Add a token only through `tokens.json` |
| Web: `/design` shows "Page not found" | The gallery is off | Set `NEXT_PUBLIC_DESIGN_GALLERY=true` in `.env.development` and restart `pnpm dev` |
| Web: a rupee sign looks different from the digits next to it | A font stack lost its Inter Tight fallback (only Inter Tight has the rupee glyph) | Regenerate with `pnpm tokens`; do not hand-edit `tailwind-theme.css` |
| Web: `addStyleTag` or an injected `<style>` is blocked in a test | The strict Content-Security-Policy refuses inline `<style>` tags (working as designed) | Set styles through the DOM (`element.style...`) or a class instead |
| Web: port 3001 already in use | Another dev server is running | Stop it, or run `pnpm dev -p 3002` |
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
