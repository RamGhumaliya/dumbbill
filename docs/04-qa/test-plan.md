# QA & Test Plan

## 1. Test pyramid
| Layer | Tooling | Scope | Gate |
|---|---|---|---|
| Unit | Jest / flutter_test | Pure domain: tax, discount allocation, WAC, loyalty rules, permissions | ≥ 85% domain coverage; property tests (fast-check) |
| Integration | Jest + Supertest + Testcontainers (Postgres w/ RLS, Redis) | Services + DB, transactions, concurrency | Every module |
| Contract | Swagger completeness test + OpenAPI snapshot diff | Every route documented with success/error examples; breaking-change detection | No undocumented route |
| Security | Custom suites + ZAP + Semgrep | IDOR sweep, RBAC matrix, cashier-leak, rate limits | **Blocking** |
| E2E web | Playwright (Chromium, WebKit) | POS flows, onboarding, refunds, offline | Critical paths green |
| Mobile | `flutter_test` (providers, repositories, widgets) + manual runs on Android emulator / iOS simulator | Checklist in `docs/04-qa/mobile-manual-checklist.md` | Checklist signed per release |
| Visual | Playwright snapshots / Chromatic | Design-system components & hero screens | Review diffs |
| Performance | k6, Lighthouse CI, Flutter profile | Budgets in `standards.md` | Budget breaks fail CI |
| Accessibility | axe-playwright, manual SR pass | WCAG 2.2 AA | No serious/critical |
| Hardware | Manual matrix | Barcode scanners, 58/80 mm printers, tablets | Sign-off before launch |

## 2. Non-negotiable automated suites
1. **Tenant isolation sweep:** auto-generates a request per route with tenant B's IDs using tenant A's token. Expect 404/403, zero data.
2. **RLS test:** per table, RLS enabled + forced; unfiltered `SELECT` returns only the session tenant.
3. **Permission matrix:** routes × roles from `permissions.matrix.ts`.
4. **Cashier leak scanner:** deep-scan every cashier-accessible response for forbidden keys.
5. **Money invariants:** property tests – Σ lines = invoice totals; discount never makes total < 0; round-off ≤ ₹0.50; ledger sum equals stock level; COGS Σ equals inventory movement value.
6. **Idempotency:** same key ×10 concurrent → one invoice.
7. **Concurrency:** 50 parallel sales of last 3 units → exactly 3 succeed (or policy-defined), no negative stock, no deadlock.
8. **Loyalty race:** parallel redemption of one coupon/points → once.
9. **Offline sync:** record 30 offline bills, drop/restore connection mid-sync, duplicate replays → exact result, conflicts flagged.
10. **Audit completeness:** every mutating endpoint tagged `@Audited` or explicitly exempt (lint rule).

## 3. Manual / exploratory charters
POS under pressure (rapid scanning, wrong barcode, cancel mid-payment) • Indian number formats/long product names • Tax edge cases (inclusive 18%/12%/5%, rounding, inter-state) with CA • Refund after redemption • Expired plan during checkout • Timezone/FY rollover (31 Mar → 1 Apr invoice sequence) • Slow 3G Android • Interrupted printer • Two admins editing the same price.

## 4. Test data
Seed generator with realistic catalogue (200 SKUs: whey, creatine, pre-workout, BCAA, mass gainers, multivitamins), 3 tenants × 2 branches, mixed GST rates, 12 months of invoices. Production data is never copied to dev; use the seed data. If a prod copy is ever needed for debugging, anonymise it first.

## 5. Bug severity & release criteria
S1 data leak/money wrong/can't bill → release blocker • S2 major flow broken w/o workaround → blocker • S3 minor → fix by next sprint • S4 cosmetic.
Release when: 0 S1/S2, all gates green, perf budgets met, security checklist + pen-test findings (high+) fixed, printer matrix passed, rollback tested, runbooks reviewed, backups restore-tested.

## 6. UAT
2 pilot retailers (3 branches), 2 weeks per phase with a feedback loop; capture bill-time metrics; weekly triage.

## 7. Launch checklist (excerpt)
DNS/TLS/WAF ✓ • Secrets rotated ✓ • Backups + restore ✓ • Alerts routed ✓ • Status page ✓ • Razorpay live webhooks ✓ • SES out of sandbox + DKIM/SPF/DMARC ✓ • Store listings, privacy policy, data-safety forms ✓ • Terms/DPA ✓ • Support inbox/runbook ✓ • Load test at 2× expected ✓ • Pen-test report ✓ • CA sign-off on invoice ✓.
