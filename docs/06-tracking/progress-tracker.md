# Progress Tracker

Legend: ⬜ not started · 🟦 in progress · ✅ done (DoD met) · ⛔ blocked
Update after each prompt. Gate = all items ✅ and reviewer + security-auditor sign-off.

## Phase 0 – Setup  (target: week 1)
| ID | Item | Owner | Status | Notes |
|---|---|---|---|---|
| P0-1 | Backend repo scaffold | Claude | ✅ | 16 Oct 2026: NestJS 11, Prisma 6, TS 5.9; lint/typecheck/build/5 tests green; /healthz, /readyz (real Postgres), /docs verified |
| P0-1b | Pre-P0-2 extras: local disk storage service, seed system + reference data (plans, GST states, categories), code comments, run-the-project docs | Claude | ✅ | 16 Oct 2026: 33 unit + 3 integration tests green; seed verified idempotent on real Postgres; from-scratch flow verified on a throwaway DB; `pnpm db:reset` not run by AI (Prisma requires user consent) |
| P0-2 | Backend DB foundations + RLS harness (Prisma) | Claude | ✅ | 16 Oct 2026: tenants+users tables, restricted app role, TenantTx, lint guard, RLS coverage audit, ADR 002. 68 tests green (36 unit, 23 integration, 9 security); sabotage check (RLS off on users) made 12 of 20 isolation tests fail, proving they detect a leak; API verified connecting as dumbbill_app |
| P0-3 | Backend observability + error contract + Swagger completeness test | Claude | ✅ | 16 Oct 2026: request ids, redacted JSON logs, RFC 9457 errors + catalogue, Sentry (off w/o DSN), OpenTelemetry (off by default), Swagger audit that fails on undocumented routes. 150 tests green (98 unit, 43 integration, 9 security). Verified live: same requestId in header, body and log |
| P0-4 | Web app scaffold | Claude | ✅ | 16 Oct 2026: Next 16 + React 19 + Tailwind 4 on design tokens (dark Iron Ledger / light Quiet Ledger), next-intl, TanStack Query, Zustand, RHF+zod, typed API layer, per-request nonce CSP, Sentry off w/o DSN. 38 unit + 29 browser tests green (both themes, axe a11y, headers). a11y gate caught and fixed a light-theme muted-text contrast failure |
| P0-5 | Design tokens JSON + web UI kit (dark/light) | Claude | ✅ | 16 Oct 2026: tokens.json (54 contrast checks, both themes) -> generated CSS; self-hosted fonts; 14 UI components on Radix + TanStack Table 9; /design gallery; raw-colour/px lint rule; 63 unit + 57 browser tests green. Found and fixed: Radix toast stuck-timer bug, light-theme control/rule contrast, Kbd on accent, missing rupee glyph in 2 fonts. Figma not connected (JSON is source) |
| P0-6 | Mobile repo scaffold (Flutter, Riverpod, clean-lite) | | ⬜ | |
| P0-7 | ADR pack, runbook skeletons, accounts checklist | | ⬜ | |
| — | Cloud/AWS, domain, Razorpay, Sentry, SES, FCM accounts | owner | ⏸ deferred | not needed for local dev |

## Phase 1 – Foundation  (weeks 1–4)
| ID | Item | Status |
|---|---|---|
| P1-1 | Auth, sessions, tenancy | ⬜ |
| P1-2 | Roles, permissions, team | ⬜ |
| P1-3 | Branches & business profile | ⬜ |
| P1-4 | Catalogue & pricing | ⬜ |
| P1-5 | Suppliers, purchases, ledger, WAC | ⬜ |
| P1-6 | Hardening + report | ⬜ |

## Phase 2 – POS  (weeks 4–7)
| P2-1 | Pricing/discount/GST engine | ⬜ |
| P2-2 | Checkout API | ⬜ |
| P2-3 | POS UI | ⬜ |
| P2-4 | Invoice, print, WhatsApp | ⬜ |
| P2-5 | Offline-tolerant POS | ⬜ |
| P2-5b | Shifts, cash drawer, barcode labels | ⬜ |
| P2-6 | Hardening + pilot | ⬜ |

## Phase 3 – Reports & Loyalty  (weeks 7–10)
| P3-0 | Supplier ledger & expenses | ⬜ |
| P3-1 | Reporting backbone | ⬜ |
| P3-2 | Dashboards | ⬜ |
| P3-3 | Customer identity & memberships | ⬜ |
| P3-4 | Loyalty rules/offers/redemption | ⬜ |
| P3-5 | Hardening | ⬜ |

## Phase 4 – Apps & Launch  (weeks 10–14)
| P4-1 | Flutter foundations | ⬜ |
| P4-2 | Customer app | ⬜ |
| P4-3 | Owner app | ⬜ |
| P4-4 | Subscriptions & limits | ⬜ |
| P4-5 | Super Admin | ⬜ |
| P4-6 | Launch hardening / go-no-go | ⬜ |

## Acceptance criteria from the PDF (final sign-off)
- [ ] Tenant A cannot access tenant B data even by changing IDs
- [ ] Cashier responses never expose purchase cost/profit
- [ ] Cashier can sell with fixed ₹ or % discount within limits
- [ ] Discounts, price edits, stock adjustments, refunds, cancellations are audited
- [ ] Sale updates correct branch stock and records cost basis
- [ ] Customer joins via code/QR and sees valid offers/rewards
- [ ] Owner sees authorised consolidated reports
- [ ] Invoices generate/share; supported printers tested

## Risk & decision log
| Date | Item | Decision |
|---|---|---|
| 2026-10-16 | Stack changed from Flutter Web/Go to Next.js/NestJS + Prisma | Approved by owner |
| 2026-10-16 | Separate repos requested earlier, then changed: ONE git repo with all folders | Owner decision (supersedes) |
| 2026-10-16 | Only two environments: dev and prod (no staging) | Owner decision |
| 2026-10-16 | Mandatory code comments added to CLAUDE.md, agents and standards | Owner request |
| 2026-10-16 | Design: dark = Iron Ledger, light = Quiet Ledger, shared type system | Owner decision |
| 2026-10-16 | File storage on server disk for now (S3 later via same interface) | Owner decision |
| 2026-10-16 | Deployment deferred; mobile release manual; ~$150/mo AWS target later | Owner decision |
| 2026-10-16 | v1 includes supplier ledger/expenses, supplier returns/write-off, shifts, barcode labels | Owner decision |
| — | CA review of GST invoice/report before Phase 2 ends | Owner to arrange (launch blocker) |
