# Product Requirements Document – Dumbbill v1

## 1. Vision & goal
Help independent protein/supplement retailers in India run stores efficiently, protect financial data, know **true per-product profitability**, and build repeat customers through a shop-specific loyalty programme.

## 2. Target users
| Persona | Description | Primary need |
|---|---|---|
| **Owner (Rakesh, 38)** | Owns 1–5 supplement shops, checks numbers on phone, not technical | "Which products actually make me money? Is my staff cheating on discounts?" |
| **Admin / Manager (Neha, 29)** | Runs a branch: purchases, stock, offers | Fast stock entry, expiry control, approvals |
| **Cashier / Shop boy (Imran, 22)** | Bills 80–200 customers/day, low patience for UI | Speed. Scan, discount, print, done. Never sees cost |
| **Customer (Aman, 25, gym-goer)** | Buys whey/creatine monthly from 1–3 shops | Points, offers, past purchases, one QR |
| **Platform Admin (you)** | Runs the SaaS | Onboard retailers, plans, suspend, usage |

## 3. Success metrics
- Cashier bill time (scan→print) **< 20 s** for 3 items; POS interaction p95 < 150 ms.
- 0 cross-tenant leaks, 0 cost fields in cashier payloads (verified by automated tests every build).
- Profit report reconciles to the ledger to the paisa.
- ≥ 60% of tenants create a loyalty offer within 30 days; 30-day customer repeat rate tracked.
- Crash-free sessions ≥ 99.5% (mobile), API availability ≥ 99.9%.

## 4. Applications
1. **Super Admin Portal** (Next.js, `/admin`)
2. **Owner/Admin Web App** (Next.js)
3. **POS** (Next.js, full-screen, keyboard + scanner first, PWA, offline-tolerant)
4. **Owner Mobile App** (Flutter) – dashboards, stock alerts, approvals, branch comparison; mobile billing deferred
5. **Customer Mobile App** (Flutter) – join shops, offers, points, history, QR
6. **API** (NestJS) – single source of truth for authz

## 5. Functional scope by phase

### Phase 0 – Setup (week 0–1)
Monorepo, CI/CD, environments, IaC skeleton, design tokens, ADRs, observability baseline, security baseline.

### Phase 1 – Foundation (weeks 1–4)
- Tenant onboarding, business profile (GSTIN, address, logo), branches
- Auth (email+password, sessions/refresh rotation, MFA-ready), password reset, email verification
- Roles & granular permissions; branch assignment; user disable
- Product catalogue (brand, category, SKU, barcode, variant/size, image, HSN, GST rate)
- Suppliers; purchase entries (invoice ref, qty, unit cost, batch, expiry, landed costs)
- Selling price with effective-dated history + who changed
- Stock ledger (purchase, sale, return, damage, adjustment, transfer) per branch; weighted-average cost engine
- Audit log (price, stock, discount, refund, cancel, permission changes)
- RLS on all tenant tables; cost-field stripping at serializer layer

### Phase 2 – POS (weeks 4–7)
- Search by name/SKU/barcode scan, cart, quantities
- Item-level and bill-level discount, ₹ or %; cashier limits; admin approval flow (PIN or remote approve)
- Server-side validation: no negative totals, discount ≤ eligible amount
- GST calculation (inclusive/exclusive; CGST+SGST intra-state, IGST inter-state), rounding rules
- Payments recorded: cash, UPI, card, split (record only; no gateway at counter in MVP)
- Invoice numbering (gap-free per branch per FY), PDF, 58/80 mm thermal, WhatsApp click-to-chat with secure invoice link
- Cancel/refund/return with permission + audit
- Hold/resume bill, offline queue with idempotent sync, shift open/close with cash reconciliation (optional toggle)

### Phase 3 – Reports & loyalty (weeks 7–10)
- Dashboards: sales (day/week/month), txn count, ATV, gross profit & margin (authorised roles), stock value, low stock, near expiry
- Best sellers, category performance, discount report, branch comparison, consolidated owner view
- Supplier balances & basic expenses (toggle)
- GST summary report; CSV/Excel export
- Loyalty: shop code, QR, signup link; earn/redeem rules (min spend, expiry, limits, exclusions); coupons, welcome offer; POS membership lookup and redemption validated server-side

### Phase 4 – Mobile apps & launch (weeks 10–14)
- Flutter Owner app, Flutter Customer app (email+password, multi-shop membership, QR, offers, history, points)
- Razorpay subscriptions, plans, trial, limits (branches/users), dunning, grace period, suspension
- Super Admin: retailer lifecycle, plan config, platform reporting, support/impersonation (audited, time-boxed)
- Push notifications (FCM), transactional email (SES)
- Load/security tests, printer matrix test, UAT, store release, runbooks

### Added to v1 scope (owner decision, 16 Oct 2026)
- **Supplier ledger & basic expenses** (Phase 3): supplier balances, payments, expense categories, monthly expense report.
- **Supplier returns & expiry write-off** (Phase 1 ledger types, UI in Phase 3): return stock to supplier (debit note, reduces supplier balance), write-off with reason; both flow through the stock ledger and COGS correctly.
- **Shift & cash-drawer reconciliation** (Phase 2): opening cash, cash in/out, expected vs counted, variance report per cashier.
- **Barcode label printing** (Phase 2): generate internal barcodes (Code128/EAN-13) and print labels (e.g., 50×25 mm) via browser print / ESC-POS label mode.
- **GST taxpayer types:** regular GST tax invoice and **bill of supply** for unregistered shops.
- **Plans:** 14-day trial, tiers Starter / Growth / Pro; limits are data-driven.
- **Defaults:** loyalty 1 pt/₹100, 100 pts = ₹50, 12-month expiry; cashier discount limit 5%; block sale at zero stock. All owner-editable.
- **Estimate impact:** extras add ≈ 2–3 weeks; total realistic plan ≈ 16–17 weeks with AI-assisted build.

### Post-MVP backlog
Mobile billing, WhatsApp Cloud API automation, segmentation & campaigns, FIFO costing toggle, e-invoicing/GSTR export, Hindi/Gujarati, accounting integrations, supplier purchase-order workflow, composition-scheme invoices, phone-OTP login for customers.

## 6. Non-functional requirements
| Area | Requirement |
|---|---|
| Security | OWASP ASVS L2 target; see `security.md` |
| Privacy | India DPDP Act 2023: consent, purpose limitation, deletion/export on request, data in ap-south-1 |
| Performance | API p95 < 300 ms (reads), < 500 ms (checkout); POS UI INP < 200 ms; LCP < 2.5 s; web bundle budget in `standards.md` |
| Availability | 99.9%, RPO ≤ 5 min (PITR), RTO ≤ 1 h |
| Accessibility | WCAG 2.2 AA; POS fully keyboard operable |
| Browser/device | Chrome/Edge latest-2, Android 8+, iOS 15+, tablets ≥ 768 px |
| Auditability | Append-only audit log, immutable invoices (corrections via credit note) |

## 7. Key business rules
1. Purchases never overwrite cost; each purchase is a new layer; WAC recomputed per branch and recorded on every sale line as `cost_at_sale` (COGS snapshot).
2. A finalised invoice is immutable. Changes happen via cancellation/credit note with reason.
3. Cashier-visible DTOs are physically separate types without cost/profit fields (not hidden by `if`).
4. Discount authority = min(role limit, tenant policy). Over-limit requires approver identity recorded.
5. A customer account is global; a **membership** is per tenant; points never cross tenants.
6. Plan limits are enforced by the API (guards), not the UI.

## 8. Out of scope (v1)
Payment gateway at counter, e-invoicing/IRN, multi-currency, marketplace/online store, delivery, native desktop apps.

## 9. Risks
| Risk | Mitigation |
|---|---|
| Thermal printer variety | Printer matrix test; fallback to browser print/PDF |
| GST misinterpretation | CA review of invoice & report before launch |
| Offline double-sale / stock conflict | Idempotency keys, server-authoritative stock, negative-stock policy per tenant |
| AI-generated code drift | CLAUDE.md rules, ADRs, mandatory review agent, CI gates |
| Scope creep | Phase gates in tracker; backlog parking lot |
