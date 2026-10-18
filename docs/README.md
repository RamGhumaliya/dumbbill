# Dumbbill – Project Documentation Index

Brand: **Dumbbill** (chosen 16 Oct 2026; still a single config value `BRAND_NAME`). Trademark, domain and app-store name availability must be checked by the owner.
Source scope: `protein_retail_saas_product_description.pdf` v1.0 (4 Oct 2026).
Last decision update: 16 Oct 2026.

## Workspace layout (ONE git repo containing docs + 3 apps)
```
protein_retail_saas_product/          <- open Claude Code HERE (workspace root)
  CLAUDE.md  .claude/agents/          <- workspace rules + role agents
  docs/                               <- planning, design, prompts, tracker (this folder)
  dumbbill-backend/    NestJS API + Prisma + Postgres
  dumbbill-web/        Next.js: owner/admin, POS, super admin
  dumbbill-mobile/     Flutter: owner app + customer app
```
The whole workspace is a single git repository with one root `.gitignore`. Each app folder has its own `CLAUDE.md`, README, lint/test setup. The backend is the source of truth; web and mobile integrate against its **Swagger/OpenAPI docs** (see `03-engineering/api-docs-standard.md`) by hand-written, typed API layers.

## Locked decisions

### Product & business
| Area | Decision |
|---|---|
| Market | India, INR, GST |
| Costing | Weighted-average cost; ledger ready for FIFO later |
| GST | Regular GST tax invoice (CGST/SGST/IGST, HSN) **and** bill of supply for unregistered shops; GST summary report; no e-invoicing/GSTR filing |
| WhatsApp | Click-to-chat link + secure invoice link (Cloud API later) |
| Subscriptions | Razorpay Subscriptions; 14-day trial; 3 tiers Starter / Growth / Pro (data-driven limits) |
| Customer auth | Email + password (+ verification, reset, rate limit, breached-password check) |
| Loyalty defaults | 1 point / ₹100 · 100 points = ₹50 · expiry 12 months (owner-editable) |
| POS defaults | Cashier discount limit 5% · block sale at zero stock (per-branch editable) |
| v1 extras (all included) | Supplier ledger + basic expenses · supplier returns + expiry write-off · shift/cash-drawer reconciliation · barcode label printing |
| Language | English only, i18n-ready |
| Seed categories | Protein & whey · Performance (creatine, pre-workout, BCAA) · Vitamins & wellness · Accessories & apparel (each with sensible default HSN/GST rates, editable) |
| Plan limits (seed) | Starter 1 branch / 3 users · Growth 3 / 10 · Pro 10 / 30. Prices blank, set by owner |
| Support | Owner handles support at first: in-app Contact support (sends request ID), support inbox, basic runbook. Support console deferred |
| Pilot | 1–2 retailers already known to the owner; UAT checklist and feedback form per phase |
| Theme default | Follow device setting; POS terminals remember their choice |
| CA review | Owner arranges before Phase 2 ends (launch blocker otherwise) |

### Technical
| Area | Decision |
|---|---|
| Backend | **Node.js + NestJS + TypeScript**, REST, **Prisma**, **class-validator**, **BullMQ**, **Pino**, Argon2; Swagger via `@nestjs/swagger` |
| Database | PostgreSQL, shared DB, `tenant_id` + **Row-Level Security** (Prisma interactive transaction sets `app.tenant_id` per request) |
| Web | **Next.js** (App Router) · Tailwind + Radix/React-Aria (own design system) · TanStack Query + Table · Zustand · react-hook-form + zod |
| Mobile | **Flutter** · **Riverpod 3** (+ riverpod_generator) · **Feature-first + Clean-lite** (data/domain/presentation) · dio + retrofit · freezed + json_serializable · go_router · flutter_secure_storage · drift |
| Offline POS | Online-first, offline-tolerant (local queue, idempotent sync) |
| Printing | Browser print (58/80 mm CSS) + ESC/POS via WebUSB/WebSerial |
| Observability | Sentry + Pino JSON logs + OpenTelemetry (CloudWatch when deployed) |
| Repository | **One git repo** for docs, backend, web and mobile (owner decision, 16 Oct 2026; supersedes the earlier "separate repos" choice). Apps stay independent folders |
| Environments | **Only `dev` and `prod`.** No staging. Backend `.env` / server env vars, web `.env.development` / `.env.production`, Flutter flavors `dev` and `prod` |
| Design tokens | JSON (Figma / Tokens Studio) → exported into web (CSS vars/Tailwind) and mobile (Dart theme) by a script in each app folder |
| Testing | Backend: Jest + Supertest + Testcontainers (real Postgres with RLS). Web: Playwright (confirmed). Mobile: `flutter_test` + Android emulator/iOS simulator by hand |
| File storage | **Server disk** (`STORAGE_LOCAL_DIR`) behind a `FileStorage` interface; S3 driver can be added later. Files are served only through authenticated API routes, never as public static files. See `runbooks/file-storage.md` |
| Seed data | Reference (plans, GST states, starter categories) in every environment; demo data local-only. See `runbooks/database-and-seeding.md` |
| Hosting | **Deferred.** Target AWS Mumbai (~$150/month lean budget). Everything runs locally via Docker Compose until you decide to deploy |
| Mobile release | **Manual** (no Fastlane/Codemagic) |

### Design
**Dark theme = Direction A "Iron Ledger"** (ink + volt-lime). **Light theme = Direction B "Quiet Ledger"** (warm white + deep teal). One shared type system (Quiet Ledger's serif dropped: Inter Tight + Barlow Condensed + JetBrains Mono) and shape language so it reads as one brand. Details: `02-design/design-guide.md` §0. Interactive preview: `02-design/directions/index.html`.

## Run it
Start at the workspace `../README.md`, then `runbooks/local-setup.md`. Other runbooks: `database-and-seeding.md`, `file-storage.md`, `troubleshooting.md`, `logging-and-errors.md`, `design-system.md`. Operations skeletons (to be completed at deployment): `runbooks/incident.md`, `runbooks/restore-db.md`, `runbooks/rotate-secrets.md`, `runbooks/rollback.md`. Contributing rules: `CONTRIBUTING.md`.

**Decisions (ADRs)** in `adr/`: 001 modular monolith, 002 Prisma + RLS, 003 RLS strategy, 004 money as paise, 005 offline sync, 006 auth and sessions, 007 costing engine, 008 PDF rendering (provisional, confirmed by a spike in P2-4).

**Accounts to create when you are ready** (none needed to keep developing): `accounts-checklist.md`.

## Reading order
1. `01-product/PRD.md` · 2. `user-journeys.md` · 3. `user-stories.md`
4. `02-design/design-guide.md`
5. `03-engineering/architecture.md` · `api-docs-standard.md` · `security.md` · `observability.md` · `standards.md`
6. `04-qa/test-plan.md`
7. `05-ai-kit/prompts/` (run in order) · agents in `/.claude/agents`
8. `06-tracking/progress-tracker.md` · `07-open-questions.md`

## Conventions
- Money: **integer paise** (BIGINT) everywhere; format only at the UI edge. Time: UTC `timestamptz`, show `Asia/Kolkata`. IDs: UUID (v7 where supported).
- Every tenant table: `id, tenant_id, created_at, updated_at, created_by`.
- Pricing/discount/GST rules live in the **backend** only. Web keeps a small offline preview copy verified by shared golden fixtures (`docs/04-qa/gst-golden/*.json`, copied into both repos).
