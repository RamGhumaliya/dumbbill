# Phase 1 – Foundation (Weeks 1–4)

Gate to start: Phase 0 all ticked, design direction chosen.

## P1-1 Auth, sessions, tenancy  (backend-dev, then R1+R2)
```
Stories: US-AUTH-01..03, US-SEC-01, US-SEC-02. Read security.md §2, architecture §4, §9, api-docs-standard.md. Work in dumbbill-backend (web screens in dumbbill-web).
Implement tenant signup (creates tenant + owner), email verification, login, refresh rotation with reuse detection, logout, password reset, Argon2id hashing with breached-password check, lockout/backoff, session list/revoke, TOTP optional for owner. Emails via SES adapter (Mailpit locally). Login by email happens before the tenant is known: implement it with a narrow SECURITY DEFINER function (see ADR 002 section 3), and never give the app role a general cross-tenant read. Separate staff and customer identity pools (customer pool arrives in P3, but design the audience claim now).
Tests: token lifecycle and reuse detection, rate limiting, enumeration-safe errors, RLS isolation, e2e signup→verify→login.
```

## P1-2 Roles, permissions, team  (backend-dev, R2)
```
Stories: US-TEAM-01, US-SEC-04. Implement the permission keys in security.md §3 as a single source (permissions.matrix.ts), the @Permission decorator + deny-by-default global guard, role templates (Owner/Admin/Cashier editable per tenant), branch assignment with BranchScopeGuard, invites, disable-user with immediate session revocation, 6-digit approval PIN (hashed, rate-limited).
Generate the route×role matrix test automatically from metadata. Document every endpoint in Swagger per api-docs-standard.md. Failing to declare a permission on a route must fail CI.
```

## P1-3 Branches & business profile  (backend-dev + frontend-dev)
```
Stories: US-BR-01. Business profile (GSTIN checksum validation, state code), branches with invoice prefix and printer width, plan-limit guard stub. Web: onboarding checklist UI per user-journeys J1, branch management screens in the chosen design direction.
```

## P1-4 Catalogue & pricing  (backend-dev + frontend-dev)
```
Stories: US-PROD-01, US-PRICE-01. Products with variants/barcodes/HSN/GST, image upload through an authenticated API route using the existing FileStorage service (server disk; validate ownership, serve files via a permission-checked download route, AV scan, WebP variants), CSV import with row errors, effective-dated price history with who/why, audit events. Separate ProductAdminDto and ProductCashierDto. Web: dense inline-editable products table (column picker, sticky header, keyboard nav); cost column absent when no permission.
Tests: cashier-leak scanner on all product endpoints.
```

## P1-5 Suppliers, purchases, stock ledger, WAC  (architect → backend-dev, then R1+R2)
```
Stories: US-PUR-01, US-STK-01, US-STK-02, US-AUD-01. Read architecture §5–§6 carefully.
First write src/modules/inventory/domain/costing.ts as pure functions with property tests (landed cost allocation pro-rata by value, WAC on purchase, sale at WAC, return at original cost, transfer). Then tables, append-only ledger with DB-level UPDATE/DELETE denial, stock_levels projection with row locking, adjustments, transfers (in-transit), alerts job (low stock, near expiry), audit log with hash chain.
Include supplier returns and expiry write-off ledger types (reduce stock at WAC, supplier debit note, audit). Tests: concurrency (parallel sales of last units), rebuild invariant Σledger==levels, historic cost retention after a second purchase.
Web: spreadsheet-style purchase entry with live WAC preview; stock page with ledger drilldown.
```

## P1-6 Phase 1 hardening  (qa-engineer, security-auditor)
```
Run the full IDOR sweep across every route, finish the RBAC matrix, add seed generator with realistic catalogue (test-plan §4). Produce docs/06-tracking/phase-1-report.md: coverage, perf numbers, open defects, risks. Fix all S1/S2.
```
