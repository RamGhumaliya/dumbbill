# Dumbbill – Workspace Rules for Claude Code

Multi-tenant SaaS for protein/supplement retailers (India, GST). Read `docs/README.md` first; docs are the source of truth. If code and docs disagree, stop and ask.

## Workspace
**One git repository** (this folder) containing four top-level areas: `docs/`, `dumbbill-backend` (NestJS), `dumbbill-web` (Next.js), `dumbbill-mobile` (Flutter). Each app folder is independent (own package manager, own `CLAUDE.md` with stack-specific rules; follow both). Never import code from one app into another; integrate only through the backend's Swagger/OpenAPI contract. One root `.gitignore` covers everything; never commit `node_modules`, build output, `.env` files, uploads or keys.

## Environments: only two
`dev` (local) and `prod`. There is no staging or test flavour in the product (Jest sets `NODE_ENV=test` internally for automated tests only). Backend: `.env` (dev) and real environment variables on the server (`.env.production.example` is the template). Web: `.env.development` / `.env.production`. Mobile: Flutter flavors `dev` and `prod` only. Never add a third environment without asking.

## Hard rules (never violate)
1. **Tenant isolation:** every tenant table has `tenant_id` + RLS (ENABLE + FORCE). Request paths never use an owner/BYPASSRLS connection. Cross-tenant lookups return **404**.
2. **Authorization on the server:** every route declares a permission; deny by default. No `if (role === ...)`; use permission keys.
3. **Cost secrecy:** cashier-audience responses use separate DTO types with no cost/WAC/COGS/profit fields. Keep the contract test.
4. **Money = integer paise**, never floats. Totals/tax/discounts are computed server-side; ignore client totals.
5. **Immutability:** finalised invoices, audit_log, stock_ledger, points_ledger are append-only. Corrections = credit notes / reversing entries.
6. **Idempotency-Key** on every money-creating POST.
7. **Audit** every price/stock/discount/refund/cancel/permission/approval/export event.
8. **No secrets in code/logs.** Redact PII and cost fields in logs.
9. **Tests with every change.** Do not leave red tests.
10. **i18n:** no hard-coded user-facing strings. Tokens only for styling (no raw hex/px).
11. **Swagger is the product's API manual:** every endpoint documented per `docs/03-engineering/api-docs-standard.md` in the same change as the code.
12. **Write proper comments in all code you produce.** See "Comments" below. Uncommented non-trivial code is an unfinished change.

## Design rules (human-made look)
Follow `docs/02-design/design-guide.md` (dark = Iron Ledger, light = Quiet Ledger, one shared type system) and its Anti-AI-look rulebook. No purple gradients, glass blobs, emoji icons, identical icon-card grids, lorem ipsum, or generic marketing copy. Realistic Indian retail data and ₹ `en-IN` formatting. Respect reduced motion. POS is keyboard-first and fast.

## Comments (mandatory)
The owner reads this code to learn it, so comments are part of the deliverable.
- Every non-trivial file has a short comment near the top saying what it is for.
- Every exported class, function, type, module and provider has a doc comment (`/** ... */` in TS, `///` in Dart) stating what it does, the rules it enforces, and what it returns or throws when not obvious.
- Comment the **why**: business rules (GST, costing, discounts), security decisions, workarounds, ordering that matters, and anything a newcomer would find surprising. Do not just restate the code.
- Explain domain terms the first time they appear (paise, HSN, CGST/SGST/IGST, WAC, RLS, idempotency key).
- Use plain, short English; no jargon without a one-line explanation. Keep comments accurate: update them in the same change as the code.
- Tests: describe the behaviour being protected, not the implementation.
- Config and data files (seed data, env templates, SQL) explain where values come from and who owns changing them.

## Code style
Small intention-named functions; comments explain *why* (see Comments); no dead code or speculative abstractions; no TODO without an issue ID; match surrounding code; Conventional Commits; PRs ≤ 400 lines.

## Workflow
- Work phase by phase using `docs/05-ai-kit/prompts/`. Update `docs/06-tracking/progress-tracker.md` when a story reaches Done.
- Before coding: restate story IDs and list files to touch. After coding: run that repo's lint, typecheck and tests, then use the `reviewer` agent (and `security-auditor` for authz/data/money changes).
- ADRs go in `docs/adr/`. Ambiguity: ask, and record the answer in `docs/07-open-questions.md`.
- Deployment/cloud work is **deferred** by the owner. Do not create AWS resources or release pipelines unless asked. Mobile release is manual.
