# Phase 3 – Reports & Loyalty (Weeks 7–10)

## P3-0 Supplier ledger & expenses  (backend-dev + frontend-dev)
```
Supplier balances, payments, debit notes from supplier returns, expense categories and entries, monthly expense and supplier-outstanding reports, permission keys, audit, Swagger docs. Profit report shows expenses separately from gross profit.
```

## P3-1 Reporting backbone  (backend-dev)
```
Stories: US-REP-01..05. Summary tables (sales_daily etc.) updated incrementally by a worker, reconciliation job proving Σsummaries == Σinvoices, permission-aware report services (reports.profit separate from reports.sales), consolidated vs branch-scoped queries, async CSV/XLSX export with signed URL, GST summary report. Tests: profit equals Σ(line net − cost_at_sale·qty) on seeded data; admin sees only assigned branches; cashier receives 403.
```

## P3-2 Dashboards  (ui-designer → frontend-dev, R3)
```
Owner dashboard (dumbbill-web) per design-guide §4: each chart must answer a stated question (write the question as a code comment). Day/week/month, ATV, margin (permission-gated, absent not blurred), stock value, low stock, near expiry, best sellers, category performance, discount report (flag outlier cashiers), branch comparison. Skeleton loading, empty states, CSV export. Charts follow the dataviz skill's rules (use the app's dark/light tokens), two hues max, tabular numerals.
```

## P3-3 Customer identity & memberships  (backend-dev, R2)
```
Stories: US-LOY-01, US-LOY-02, US-LOY-05. Global customers table (email+password, Argon2id, verification, breached check, rate limit, step-up email OTP on new device), separate JWT audience and DB role/policies, shop codes (≥8 chars, unambiguous alphabet, regenerate invalidates), QR + signup link + printable poster PDF, memberships per tenant, consent records, data export/delete flows.
```

## P3-4 Loyalty rules, offers, coupons, redemption  (backend-dev + frontend-dev, R1+R2)
```
Stories: US-LOY-03, US-LOY-04. Rules engine in dumbbill-backend (src/modules/loyalty/domain) (earn, redeem, min spend, expiry, usage limits, exclusions; non-retroactive versions), points_ledger append-only, coupon/offer CRUD UI, POS membership lookup (scan QR rotating token / phone / email) and reward eligibility listing, redemption inside the checkout transaction with row locks. Tests: parallel double-redeem, expiry boundaries, reversal on refund.
```

## P3-5 Phase 3 hardening  (qa-engineer, security-auditor)
```
Report reconciliation tests, pen-test of customer endpoints (enumeration, brute force, IDOR across memberships), perf of reports at 1M invoices, pilot UAT. docs/06-tracking/phase-3-report.md.
```
