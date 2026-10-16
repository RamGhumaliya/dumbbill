# Phase 0 – Setup (Week 0–1)

Run Claude Code from the **workspace root** (`protein_retail_saas_product/`). The workspace is ONE git repo (root `.gitignore` exists); each app is a folder inside it. Only two environments exist: dev and prod. No cloud/deploy work in this phase. Every file you write needs proper comments (see CLAUDE.md "Comments").

## P0-1 Backend repo scaffold  (ROLE: architect → backend-dev)
```
Read CLAUDE.md, dumbbill-backend/CLAUDE.md, docs/README.md, docs/03-engineering/architecture.md and standards.md.
In dumbbill-backend create a NestJS (TypeScript strict) project: modules folder layout per its CLAUDE.md, Prisma, class-validator/class-transformer with a global ValidationPipe (whitelist, forbidNonWhitelisted), Pino logger, typed env validation that fails fast, @nestjs/swagger at /docs with the global description from docs/03-engineering/api-docs-standard.md, /healthz and /readyz.
Add docker-compose.yml (postgres 16, redis, mailpit; no object store, uploads go to local disk), ESLint (no-explicit-any as error), Prettier, commitlint + husky, .editorconfig, .nvmrc (Node 22), Jest config (unit, integration, security folders), .env.example, README with run instructions.
VERIFY: npm/pnpm install, lint, typecheck, test pass; docker compose up works; GET /healthz 200; /docs renders.
```

## P0-2 Backend DB foundations & RLS harness  (ROLE: architect → backend-dev)
```
Read architecture §4–§6 and dumbbill-backend/CLAUDE.md "Prisma + RLS".
Create DB roles (owner/migrator, app_user without BYPASSRLS), base tables (tenants, users), UUID id strategy, a TenantTx helper that wraps each request in prisma.$transaction and runs set_config('app.tenant_id', $1, true) and app.user_id, an ESLint rule/test that forbids the global PrismaService in request paths, a migration helper that applies the RLS policy template to a table, and a generated test asserting every tenant_id table has RLS ENABLE+FORCE+policy.
Write docs/adr/002-prisma-rls.md documenting the approach and caveats.
VERIFY: integration test with two tenants proves an unfiltered query under tenant A returns only A rows; removing a policy makes the generated test fail.
```

## P0-3 Backend observability & error contract  (ROLE: backend-dev)
```
Read docs/03-engineering/observability.md and api-docs-standard.md §3.
Add requestId propagation (AsyncLocalStorage), Pino redaction list, global exception filter returning RFC 9457 problem+json with requestId and stable codes, Sentry (disabled without DSN), OpenTelemetry console exporter, and a test that fails if logs contain forbidden keys (password, token, pin, unitCost, wac, profit…). Add the Swagger completeness test skeleton (fails if a route lacks tags/operation/success+error responses/permission note).
VERIFY: thrown error shows same requestId in log and response; secrets redacted; completeness test fails on a deliberately undocumented route.
```

## P0-4 Web repo scaffold  (ROLE: frontend-dev)
```
Read dumbbill-web/CLAUDE.md, docs/02-design/design-guide.md §0, docs/03-engineering/standards.md §3.
In dumbbill-web create Next.js App Router (TypeScript strict) with route groups (owner) (pos) (admin), Tailwind wired to CSS-variable tokens, next-intl with messages/en.json, TanStack Query provider, Zustand, react-hook-form + zod, ESLint (jsx-a11y), Prettier, Playwright + axe, Sentry (disabled without DSN), .env.example, README.
Typed API layer skeleton in src/lib/api (fetch wrapper: auth header, problem+json parsing, requestId surfacing, refresh handling stub).
VERIFY: lint, typecheck, build pass; placeholder pages render in dark and light themes.
```

## P0-5 Design tokens & UI kit  (ROLE: ui-designer → frontend-dev)
```
Direction is decided: dark = Iron Ledger, light = Quiet Ledger, one shared type system (design-guide §0).
Step A: write the tokens JSON (docs/02-design/tokens/tokens.json: color roles for both themes, type scale, spacing, radius, motion). If Figma is connected, create variables in Figma from it; otherwise keep JSON as the source.
Step B (web): script that converts tokens.json into CSS variables + Tailwind preset; self-hosted subset fonts (Inter Tight, Barlow Condensed, JetBrains Mono); build src/components/ui: Button, Input, Select, Checkbox, Table (TanStack), Dialog, Popover, Toast, Badge/Tag, Tabs, Kbd, MoneyText (en-IN, tabular), EmptyState, Skeleton. All states, keyboard support, both themes. Storybook optional.
VERIFY: no raw hex/px outside tokens (lint rule); axe clean; contrast checked for every token pairing; reviewer applies Squint+Swap.
```

## P0-6 Mobile repo scaffold  (ROLE: mobile-dev)
```
Read dumbbill-mobile/CLAUDE.md and docs/03-engineering/standards.md (Mobile).
Create the Flutter project with two entrypoints (main_owner.dart, main_customer.dart) and build flavors dev and prod only; folder layout core/ + features/ (data/domain/presentation); Riverpod 3 + riverpod_generator, dio + retrofit, freezed + json_serializable, go_router, flutter_secure_storage, drift, intl ARB, sentry_flutter (disabled without DSN), very_good_analysis lints. Theme: generate Dart ThemeExtension from docs/02-design/tokens/tokens.json for dark and light (script in tool/, same validation and contrast check as dumbbill-web/scripts/lib/tokens.ts; see docs/runbooks/design-system.md). Only Inter Tight has the rupee sign: give the numerals and code TextStyles a fontFamilyFallback of Inter Tight. Network layer: dio with auth interceptor (refresh once on 401), problem+json error mapping.
VERIFY: flutter analyze clean, flutter test passes, app launches on Android emulator in both themes with a placeholder screen.
```

## P0-7 ADR pack, runbook skeletons, accounts checklist  (ROLE: architect)
```
Write docs/adr/ADR-001, 003–008 (see architecture §14) and docs/runbooks skeletons (incident, restore-db, rotate-secrets, rollback). Create docs/accounts-checklist.md listing what the owner must create when ready (Sentry, Razorpay test, SES, FCM, Apple/Google developer accounts, domain, AWS) — none are needed to continue development locally.
```
