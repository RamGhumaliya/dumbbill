# Engineering Standards & Performance Budgets

## 1. General
- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any` (lint error), ESM, Node 22 LTS, pnpm workspaces, Turborepo caching.
- Dart: `flutter_lints` + `very_good_analysis`, null-safety, Riverpod (or Bloc – pick in ADR), `freezed` models, `go_router`.
- Formatting by Prettier / `dart format`; lint in CI; zero warnings policy.
- Conventional Commits; trunk-based with short-lived branches; PRs ≤ 400 lines; squash merge; CODEOWNERS; required reviews + green CI.
- Docs-as-code: ADRs in `/docs/adr`, OpenAPI is the contract.

## 2. Backend (NestJS)
- Layering: `controller (HTTP only) → service (use-case) → domain (pure logic, no I/O) → repository`.
- Domain math (pricing, tax, WAC, discount allocation) lives in `src/modules/*/domain` as pure functions with property-based tests (fast-check). The web POS keeps a small offline preview copy; both must pass the same golden fixtures in `docs/04-qa/gst-golden/`. The API is authoritative.
- DTOs are classes validated with class-validator (`whitelist`, `forbidNonWhitelisted`) and documented with `@nestjs/swagger`; response DTO per audience; no Prisma entity returned directly.
- Transactions via a `UnitOfWork`; no I/O in loops (N+1 banned; use batch queries); queries have explicit column lists.
- Errors: throw typed `DomainError(code, status)`; global filter maps to problem+json; never leak stack traces.
- Config: typed env schema validated at boot (fail fast); feature flags module.
- No `console.log`; use injected logger. No business logic in controllers or SQL triggers (except RLS/audit guards).
- Migrations: reversible where possible, reviewed, zero-downtime pattern, never edited after merge.
- DB: FKs, CHECK constraints (`qty >= 0` where applicable, `discount <= subtotal`), partial/unique indexes, `EXPLAIN` for new queries on big tables.
- Time via injected `Clock`; randomness via injected `Ids`—testable.

## 3. Web (Next.js)
- App Router, Server Components for data-heavy read screens, client components for POS. Route groups: `(owner)`, `(pos)`, `(admin)`.
- Data: hand-written typed API layer (one function per endpoint, zod-validated responses) + TanStack Query (stale-while-revalidate, optimistic updates only for safe ops, never for money).
- State: URL for filters; Zustand for POS cart; forms via react-hook-form + zod (shared schemas).
- Styling: Tailwind with **our** token preset + CSS variables; component primitives from Radix/React-Aria wrapped in our design system (`src/components/ui`); no inline hex/px magic numbers.
- i18n: `next-intl`, all copy keys; number/currency/date via `Intl` with `en-IN`.
- Security: strict CSP, no third-party scripts on /pos, `sanitize` rich text, `rel=noopener`.
- Accessibility lint (`eslint-plugin-jsx-a11y`) + axe in Playwright.

## 4. Mobile (Flutter)
- Feature-first + clean-lite (`data/domain/presentation` per feature); Riverpod 3 with generators; `dio` + `retrofit` API layer written against the Swagger docs; `freezed` + `json_serializable`; `go_router`; `flutter_secure_storage`; Drift for offline cache; ARB strings; theme from tokens (dark/light `ThemeExtension`).
- Performance: const widgets, avoid rebuild storms, `RepaintBoundary` on QR/animations, image caching (`cached_network_image`), isolates for heavy parsing.
- Flavors: `dev` and `prod` only. Releases are manual (owner decision); obfuscation and a forced-update gate are still recommended at release time.

## 5. Performance budgets (CI-enforced)
| Metric | Budget |
|---|---|
| POS initial JS (gz) | ≤ 180 KB route, total ≤ 350 KB; no moment/lodash full imports |
| Owner app route JS | ≤ 220 KB first load |
| LCP / INP / CLS | ≤ 2.5 s / ≤ 200 ms / ≤ 0.1 on mid Android over 4G |
| POS scan→cart paint | ≤ 100 ms (local), 60 fps animations |
| API p95 | read ≤ 300 ms, checkout ≤ 500 ms, reports ≤ 1.5 s (cached ≤ 300 ms) |
| DB | no query > 100 ms p95 on OLTP; index coverage reviewed |
| Mobile | cold start ≤ 2 s mid-range, APK ≤ 25 MB, jank < 1% |
Tools: Lighthouse CI, `size-limit`, k6 load tests (target 200 concurrent POS terminals, 50 bills/s burst), Flutter DevTools profile builds, `pg_stat_statements`.

## 6. Quality gates (CI blocks merge)
Typecheck • lint • unit coverage ≥ 85% on domain, ≥ 70% overall • integration (real Postgres with RLS on, throwaway database per test file) • Swagger completeness test + OpenAPI snapshot diff • RLS & permission-matrix tests • cashier-leak test • a11y • bundle budgets • Semgrep/CodeQL • dependency audit • secret scan • migration lint.

## 7. Code-review checklist (Review Agent + human)
Tenant scoped? permission declared? DTO audience correct? money in paise? idempotent? audited? logged without PII? errors typed? tests for failure paths? N+1? migration safe? i18n keys? tokens only? a11y? bundle impact?

## 8. "Human-quality" code rules (for AI output)
- **Comments are mandatory** (see `CLAUDE.md` "Comments"): file purpose, doc comment on every exported symbol, and the why behind business rules, security choices and non-obvious code. Plain English, kept accurate.
- Match existing patterns; no speculative abstractions; small functions with intention-revealing names; comments explain *why*.
- No dead code, no TODO without ticket, no placeholder data in committed code, no generic "Helper/Util/Manager" dumping grounds.
- Every generated file must compile, pass lint and have tests in the same change.
