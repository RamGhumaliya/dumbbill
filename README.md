# Dumbbill

Multi-tenant SaaS for protein and supplement retailers in India: point-of-sale billing, inventory and true profit tracking, GST invoices, and a customer loyalty app.

This folder is **one git repository**. It holds the planning documents and the three apps as separate folders.

```
protein_retail_saas_product/
├── README.md                       <- you are here
├── CLAUDE.md                       <- rules for the AI assistant (Claude Code)
├── .claude/agents/                 <- AI role agents (architect, backend, frontend, mobile, designer, QA, security, reviewer)
├── docs/                           <- product, design, engineering, QA, AI prompts, tracker
├── dumbbill-backend/               <- API (NestJS + Prisma + PostgreSQL)       [started]
├── dumbbill-web/                   <- Owner/admin web app, POS, super admin (Next.js)   [scaffolded]
└── dumbbill-mobile/                <- Owner app and customer app (Flutter)     [not started]
```

## Current status

| Step | State |
|---|---|
| Planning docs (PRD, design, architecture, security, QA, prompts) | Done |
| P0-1 Backend scaffold | Done |
| Local disk file storage | Done (service only; HTTP upload endpoint arrives with login in Phase 1) |
| Seed system + reference data | Done |
| P0-2 Row-level security foundation | Done (see `docs/adr/002-prisma-rls.md`) |
| P0-3 Logging, error format, Swagger completeness test | Done (see `docs/runbooks/logging-and-errors.md`) |
| P0-4 Web app scaffold (Next.js) | Done (see `dumbbill-web/README.md`) |
| P0-5 Design tokens JSON and UI kit | Done (see `docs/runbooks/design-system.md`; gallery at `/design`) |
| P0-6 Mobile app scaffold (Flutter) | Done (see `dumbbill-mobile/README.md`) |
| P0-7 ADR pack, runbook skeletons, accounts checklist | Done (see `docs/adr/` and `docs/accounts-checklist.md`) |
| P1-1 Auth, sessions, tenancy (backend and web screens) | Done (see `docs/api/auth-flow.md`, ADR 006) |
| P1-2 Roles, permissions, team (backend, accept-invitation page) | Done (see `docs/api/team-and-permissions.md`, ADR 009) |
| P1-3 Business profile, GSTIN, branches, first-steps checklist (backend and web) | Done (see `docs/api/business-and-branches.md`, ADR 010) |
| P1-4 Catalogue and pricing: products, price history, pictures, CSV import (backend and web) | Done, not yet committed (see `docs/api/catalogue.md`, ADR 011) |
| P1-5 Suppliers, purchases, stock ledger, weighted average cost, transfers, audit log and hash chain (backend and web) | Done, not yet committed (see `docs/api/purchasing-and-stock.md`, ADR 012) |
| Phase 0 | Complete |
| Phase 1 | In progress. Next: P1-6 hardening and report (`docs/05-ai-kit/prompts/phase-1-foundation.md`) |

The live checklist is `docs/06-tracking/progress-tracker.md`.

## Run it (backend)

You need: **Node 22**, **pnpm 10**, **Docker Desktop** (running).

```bash
cd dumbbill-backend
pnpm install                  # installs packages and generates the Prisma client
docker compose up -d          # starts PostgreSQL, Redis and Mailpit
pnpm db:migrate               # creates the database tables
pnpm db:seed                  # loads plans, GST states and starter categories
pnpm dev                      # starts the API on http://localhost:3000
```

Run the web app in a second terminal (it works without the API, and shows a status message until the API is up):

```bash
cd dumbbill-web
pnpm install
cp .env.development.example .env.development
pnpm dev                      # http://localhost:3001
```

Then open:

| URL | What you see |
|---|---|
| http://localhost:3000/docs | Swagger: the interactive API manual |
| http://localhost:3000/healthz | `{"status":"ok"}` |
| http://localhost:3000/readyz | Confirms the database is reachable |
| http://localhost:8025 | Mailpit: catches every email the app sends in development |
| http://localhost:3001 | The web app: `/` owner dashboard, `/pos` point of sale, `/admin` super admin |

Full instructions, every setting explained, and fixes for common problems: `docs/runbooks/`.

## Where to read next

| I want to... | Read |
|---|---|
| Set up my machine | `docs/runbooks/local-setup.md` |
| Understand the database, migrations and seed data | `docs/runbooks/database-and-seeding.md` |
| Understand how uploaded files are stored | `docs/runbooks/file-storage.md` |
| Change a colour, add a component, review a screen | `docs/runbooks/design-system.md` |
| Fix something that is not working | `docs/runbooks/troubleshooting.md` |
| Know how to contribute code | `docs/CONTRIBUTING.md` |
| Understand the product | `docs/01-product/PRD.md` |
| See every decision made so far | `docs/README.md` |
| Build the next step with AI | `docs/05-ai-kit/prompts/` |

## Key decisions at a glance

Next.js web and POS, Flutter mobile (Riverpod, feature-first), NestJS + Prisma + PostgreSQL backend with row-level security, English only (translation-ready), GST invoices for registered and unregistered shops, Razorpay subscriptions, files on the server disk for now, deployment deferred. Dark theme "Iron Ledger" and light theme "Quiet Ledger" share one type system.
