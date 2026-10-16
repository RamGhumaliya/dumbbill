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
├── dumbbill-web/                   <- Owner/admin web app, POS, super admin (Next.js)   [not started]
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
| P0-3 Logging, error format, Swagger completeness test | Next |
| Web and mobile repos | Not started |

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

Then open:

| URL | What you see |
|---|---|
| http://localhost:3000/docs | Swagger: the interactive API manual |
| http://localhost:3000/healthz | `{"status":"ok"}` |
| http://localhost:3000/readyz | Confirms the database is reachable |
| http://localhost:8025 | Mailpit: catches every email the app sends in development |

Full instructions, every setting explained, and fixes for common problems: `docs/runbooks/`.

## Where to read next

| I want to... | Read |
|---|---|
| Set up my machine | `docs/runbooks/local-setup.md` |
| Understand the database, migrations and seed data | `docs/runbooks/database-and-seeding.md` |
| Understand how uploaded files are stored | `docs/runbooks/file-storage.md` |
| Fix something that is not working | `docs/runbooks/troubleshooting.md` |
| Know how to contribute code | `docs/CONTRIBUTING.md` |
| Understand the product | `docs/01-product/PRD.md` |
| See every decision made so far | `docs/README.md` |
| Build the next step with AI | `docs/05-ai-kit/prompts/` |

## Key decisions at a glance

Next.js web and POS, Flutter mobile (Riverpod, feature-first), NestJS + Prisma + PostgreSQL backend with row-level security, English only (translation-ready), GST invoices for registered and unregistered shops, Razorpay subscriptions, files on the server disk for now, deployment deferred. Dark theme "Iron Ledger" and light theme "Quiet Ledger" share one type system.
