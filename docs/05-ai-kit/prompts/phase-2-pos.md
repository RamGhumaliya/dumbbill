# Phase 2 – POS (Weeks 4–7)

## P2-1 Pricing, discount & GST engine  (backend-dev; domain package first)
```
Stories: US-POS-02, US-POS-04. In dumbbill-backend (src/modules/pos/domain) implement pure, integer-paise functions: line pricing at effective price, item then bill discount with pro-rata allocation (rounding remainders assigned deterministically), inclusive/exclusive tax, CGST/SGST vs IGST by place of supply, round-off line, HSN summary. Property tests: totals never negative, Σ lines == invoice, discount ≤ eligible, allocation sums exactly. Golden-file fixtures for common supplement GST rates (5/12/18%) to be validated by a CA — put fixtures in docs/04-qa/gst-golden/ and copy them into dumbbill-web for the offline preview test. Support tax invoice (regular GST) and bill of supply (unregistered).
```

## P2-2 Checkout API  (backend-dev, R1+R2 mandatory)
```
Stories: US-POS-03, US-POS-06. Implement architecture §7 exactly: idempotency, server-authoritative pricing, approval tokens bound to cart hash, single transaction (stock lock → ledger → invoice → payments → numbering → audit), gap-free invoice sequence per branch per FY (row-locked counter), cancel/refund producing credit notes and restock/damage handling, cashier DTO output.
Tests: 50 parallel checkouts of last 3 units, 10 parallel identical idempotency keys, FY rollover, over-limit discount rejection, tampered totals ignored, cashier-leak scan.
```

## P2-3 POS UI  (frontend-dev + ui-designer, R3)
```
Stories: US-POS-01, US-POS-08, US-POS-09. Build /pos per design-guide §4: full-bleed, keyboard-first (F2 search, F4 discount, F9 pay, Esc cancel), scanner input (HID keyboard-wedge handling with timing heuristic), cart table, huge tabular totals, discount popover with limit feedback, approval flow (PIN/remote), customer chip, payment split, hold/resume, shift open/close. Optimistic preview only; server response is truth. Measure scan→cart paint and fail CI over budget.
```

## P2-4 Invoice, print, share  (frontend-dev + backend-dev)
```
Stories: US-POS-05. Server PDF (A4 + 58/80 mm), thermal ESC/POS via WebUSB/WebSerial with browser-print CSS fallback, auto-print setting, reprint with audit, WhatsApp click-to-chat with 90-day signed invoice URL (public route, unguessable token, rate-limited, no PII beyond invoice). Printer test page and matrix doc docs/04-qa/printer-matrix.md.
```

## P2-5 Offline-tolerant POS  (architect → frontend-dev + backend-dev, R2)
```
Stories: US-POS-07. Implement architecture §8: service worker, IndexedDB catalogue snapshot with delta sync, encrypted offline bill queue, leased invoice-number blocks, POST /pos/invoices:sync with ACCEPTED / ACCEPTED_WITH_ADJUSTMENT / REJECTED, resolution queue UI, limits (24 h/200 bills; refunds and over-limit discounts online-only).
Tests: Playwright network throttle/offline, duplicate replays, mid-sync disconnect, price drift conflict.
```

## P2-5b Shifts, cash drawer & barcode labels  (backend-dev + frontend-dev)
```
Shift open/close with opening cash, cash in/out, expected vs counted, variance report per cashier (permission-gated). Barcode label printing: generate internal Code128/EAN-13 codes for products without a barcode, label template (e.g., 50x25 mm) via browser print and ESC/POS label mode, bulk print from purchase receipt. Audit shift variances and label code generation.
```

## P2-6 Phase 2 hardening  (qa-engineer, security-auditor)
```
Load test with k6 (200 terminals), printer matrix on real hardware, a11y pass, pilot UAT with one retailer. Produce docs/06-tracking/phase-2-report.md. Fix all S1/S2.
```
