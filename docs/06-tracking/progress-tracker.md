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
| P0-6 | Mobile app scaffold (Flutter, Riverpod, clean-lite) | Claude | ✅ | 18 Oct 2026: two apps (owner, customer) from one codebase, flavors dev/prod, tokens generated from the shared tokens.json (same 54 contrast checks), self-hosted fonts with rupee fallback, dio+retrofit network layer (request ids, single refresh on 401, RFC 9457 error mapping), drift cache, Sentry off w/o DSN, worked example feature. `flutter analyze` clean, 83 tests green (incl. accessibility guidelines, both themes). Verified on an Android 37.1 emulator: both apps, light and dark, live "Server is ready" via 10.0.2.2. Found and fixed: Kotlin incremental cache fails across drives (C: vs D:), Sentry needs minSdk 26, Riverpod 3 auto-retry hid errors (turned off), Sentry 10 has no copyWith. iOS schemes need a Mac (manual) |
| P0-7 | ADR pack, runbook skeletons, accounts checklist | Claude | ✅ | 18 Oct 2026: ADRs 001, 003-008 (002 already existed); runbooks incident, restore-db, rotate-secrets, rollback (skeletons; restore-db local backup/restore tested on a scratch database, same table count); accounts-checklist.md. ADR-008 (PDF) is provisional pending a spike in P2-4. Docs only, no code changed |
| — | Cloud/AWS, domain, Razorpay, Sentry, SES, FCM accounts | owner | ⏸ deferred | not needed for local dev |

## Phase 1 – Foundation  (weeks 1–4)
| ID | Item | Status |
|---|---|---|
| P1-1 | Auth, sessions, tenancy | ✅ 18 Oct 2026 (not yet committed; reviewer and security-auditor agents not yet run) |

**P1-1 result (US-AUTH-01..03, US-SEC-01/02).** Backend: signup (business + owner, 14-day trial), email verification (24 h, single use), login, refresh rotation with reuse detection, logout, password reset (30 min, single use, ends all sessions), change password, session list/revoke, optional TOTP with recovery codes, Argon2id + versioned pepper, breached-password check, lockout/backoff, rate limits, immediate revocation list, append-only audit log, login by email through a narrow `SECURITY DEFINER` function. Web: login (incl. two-step and lockout countdown), signup, confirm email, forgot/reset password, sign-in gate on owner/POS/admin, account security page (change password, devices, two-step setup). Evidence: backend 326 tests (183 unit, 117 integration, 26 security; was 150), typecheck/lint/build clean; web 100 unit + 108 browser tests, typecheck/lint/format clean; sabotage check (6 protections broken one at a time: each was caught); live run with real Redis, Mailpit and PostgreSQL in a real browser (cookies httpOnly, session survives reload, sign-out clears it, no CSP or CORS errors). Bugs found and fixed on the way: `PASSWORD_BREACH_CHECK=false` was read as true (text-to-boolean conversion); `TenantTx.runAs` did not set the in-process tenant context (audit rows failed); two recovery codes used at once could resurrect a spent one; `app_grant_defaults()` would have re-opened the audit log to UPDATE/DELETE on the next migration; two-step code box was not focused; reset/verify links (secret in the address) would have reached Sentry. Details: `docs/adr/006-auth-and-sessions.md` section 6, `docs/api/auth-flow.md`.

**Known limits left for later:** audit-log hash chain (security.md section 6) is not built (needs a concurrency design; P1-6); no absolute maximum session age (the 30-day window is sliding; consider 90 days in P1-6); a disabled user's access token lives up to 15 minutes (P1-2 makes the permission check re-read status); two-step setup shows the key as text, not a QR code; customer identity pool is Phase 3; mobile login screens are not built (the mobile refresher is still a placeholder); production needs the migration role allowed to change the owner of `find_login_by_email` (see ADR 006).
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
