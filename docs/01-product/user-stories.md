# User Stories & Acceptance Criteria

Each story ID is referenced in tests (`it('US-POS-03 …')`) and in the progress tracker. Given/When/Then is the contract for QA.

## Security & tenancy (cross-cutting, Phase 1, tested every build)
| ID | Story | Acceptance |
|---|---|---|
| US-SEC-01 | As a tenant, my data is invisible to others | **Given** user of tenant A **When** requesting any resource ID belonging to tenant B (GET/PUT/DELETE, all endpoints) **Then** 404 (not 403) and nothing leaks. Automated enumeration test covers every route. |
| US-SEC-02 | RLS is defense in depth | Raw SQL run with tenant A's session setting cannot read B rows even if app code forgets a filter (test with deliberately unfiltered query). |
| US-SEC-03 | Cashier never sees cost/profit | Contract test walks every cashier-accessible endpoint and asserts response JSON contains none of: `purchaseCost, unitCost, wac, cogs, costAtSale, profit, margin, supplier*Price`. Schema-level: cashier DTO types don't define these fields. |
| US-SEC-04 | Role is enforced by API | Calling an admin endpoint with cashier token → 403 + audit entry, regardless of UI. |

## Phase 1 – Foundation
| ID | Story | Acceptance |
|---|---|---|
| US-AUTH-01 | Owner registers and verifies email | Password policy (≥10 chars, breached-list check), verification link expires 24 h, resend limited. |
| US-AUTH-02 | Login/refresh/logout | Access token 15 min; refresh rotation with reuse detection (reuse revokes family); lockout/backoff after 5 failures; logout revokes server-side. |
| US-AUTH-03 | Reset password | Single-use 30-min token; all sessions revoked; email notification sent. |
| US-BR-01 | Owner creates branches | Limited by plan; unique invoice prefix per branch; GSTIN/state per branch for tax logic. |
| US-TEAM-01 | Owner invites admin/cashier and assigns branches | Invite email; role + branch scope + granular permissions (JSON matrix in `security.md`); disable user revokes sessions immediately. |
| US-PROD-01 | Admin manages catalogue | Barcode unique per tenant (with variants); HSN & GST % required for tax-registered tenants; image ≤ 2 MB resized server-side; CSV import with row-level error report. |
| US-PRICE-01 | Selling price history | Every price change creates an effective-dated row + audit (who, old, new, reason); POS uses price effective at bill time. |
| US-PUR-01 | Record purchase | Lines with qty, unit cost, batch, expiry; landed costs allocated pro-rata by value; creates ledger `PURCHASE` entries; supplier balance updated; historic costs unchanged (test: purchase 2 at different costs → both layers retained and WAC = weighted mean). |
| US-STK-01 | Stock ledger | Append-only; stock on hand = sum(ledger) per branch/product (property test); adjustments need reason; transfers two-phase. |
| US-STK-02 | Alerts | Low-stock threshold per product/branch; near-expiry window (default 60 days) configurable; daily digest. |
| US-AUD-01 | Audit log | Records actor, role, IP, device, entity, before/after JSON, timestamp; append-only (DB rule denies UPDATE/DELETE); viewable by Owner with filters. |

## Phase 2 – POS
| ID | Story | Acceptance |
|---|---|---|
| US-POS-01 | Search/scan to cart | Barcode scan adds within 100 ms; search by name/SKU debounced 150 ms; keyboard-only possible; shows stock available for this branch only. |
| US-POS-02 | Discounts | Fixed ₹ or %; item or bill level; server recomputes everything; reject if total < 0 or discount > eligible amount; cashier limit from tenant policy; over-limit → `APPROVAL_REQUIRED` flow with approver recorded. |
| US-POS-03 | Checkout | Atomic transaction: invoice + lines + payments + stock ledger + COGS snapshot + loyalty + audit. Idempotency-Key makes retries safe (same key → same invoice). Invoice number gap-free per branch/FY. |
| US-POS-04 | GST | Intra-state split CGST/SGST, inter-state IGST; inclusive/exclusive pricing; rounding to paise per line then invoice round-off line; HSN summary on invoice. Golden-file tests reviewed by a CA. |
| US-POS-05 | Print & share | 58/80 mm layouts verified on printer matrix; fallback PDF; WhatsApp link opens `wa.me/<phone>?text=` with 90-day signed invoice URL. |
| US-POS-06 | Cancel/refund | Requires permission; reason mandatory; creates credit note; restocks or marks damaged; reverses points; audited. Original invoice stays immutable. |
| US-POS-07 | Offline-tolerant | Network loss shows banner; scanning/billing continues for cached catalogue; bills stored encrypted in IndexedDB; on reconnect sync in order with idempotency; conflicts (price changed, stock gone) surface in a resolution queue; nothing silently lost (E2E test with network throttle). |
| US-POS-08 | Hold/resume | Up to 5 held carts per terminal. |
| US-POS-09 | Speed | Add-to-cart paint < 100 ms; checkout round-trip p95 < 500 ms. |

## Phase 3 – Reports & Loyalty
| ID | Story | Acceptance |
|---|---|---|
| US-REP-01 | Sales dashboard | Day/week/month, txn count, ATV; numbers equal sum of invoices (reconciliation test). |
| US-REP-02 | Profit report | Gross profit = Σ(line net − cost_at_sale·qty); visible only with `reports.profit` permission; excluded from cashier & unauthorised admin. |
| US-REP-03 | Stock valuation | Σ(qty × WAC) per branch; ties to ledger. |
| US-REP-04 | Consolidated | Owner sees all branches; Admin only assigned branches. |
| US-REP-05 | Exports | CSV/XLSX with same permissions; async for > 50k rows with signed download. |
| US-LOY-01 | Shop code/QR/link | Unique non-guessable code (≥ 8 chars, no ambiguous chars); regenerate invalidates old; QR poster PDF. |
| US-LOY-02 | Join shop | Customer joins via code; membership per tenant; duplicates idempotent. |
| US-LOY-03 | Rules | Earn rate, redeem value, min spend, expiry, usage limit, exclusions; evaluated only on the server; rule changes not retroactive. |
| US-LOY-04 | Redeem at POS | Reward validated at checkout; points deducted in same transaction; can't double-redeem in parallel (row lock test). |
| US-LOY-05 | Consent | Marketing comms opt-in explicit; unsubscribe; export/delete my data. |

## Phase 4 – Apps & SaaS
| ID | Story | Acceptance |
|---|---|---|
| US-APP-01 | Customer app | Register/login, join multiple shops, separate balances, QR (rotating token, 60 s) , history, offers. |
| US-APP-02 | Owner app | Dashboards, alerts, approvals, biometric unlock, push notifications. |
| US-SUB-01 | Plans & limits | Branch/user limits enforced by API guard; downgrade blocked if over limit. |
| US-SUB-02 | Razorpay | Webhook signature verified; idempotent event handling; states trial/active/past_due/suspended/cancelled mirror gateway. |
| US-SA-01 | Super Admin | Retailer list, status, usage; suspend/reactivate; impersonation audited and visible to tenant. |

## Definition of Done (every story)
Code + unit/integration tests + OpenAPI updated + permission matrix updated + audit events where applicable + logging/metrics added + a11y checked + no new Sentry errors during local runs + reviewed by Review Agent + tracker updated.
