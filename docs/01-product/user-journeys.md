# User Journeys

Format: Trigger → Steps → Success → Edge/failure cases.

## J1. Retailer onboarding (Owner)
**Trigger:** Owner signs up from the marketing page or is invited by Super Admin.
1. Sign up (name, email, password, phone) → verify email.
2. Business profile: name, GSTIN (optional with warning), state, address, logo.
3. Choose plan / start trial (Razorpay mandate collected at end of trial, or skip).
4. Create first branch (name, address, invoice prefix, printer width 58/80).
5. Guided checklist: add products (CSV import or manual) → add supplier → record first purchase → invite cashier → make a test bill.
**Success:** first bill printed within 30 minutes of signup.
**Edge:** invalid GSTIN checksum; duplicate email; trial expired; branch limit hit (upsell prompt).

## J2. Add product & first purchase (Admin)
1. Products → New: name, brand, category, variant (e.g. 2 kg / Chocolate), barcode (scan or generate), HSN, GST %, MRP, selling price.
2. Purchases → New: supplier, invoice ref/date, lines (product, qty, unit cost, batch, expiry), extra costs (freight) allocated pro-rata.
3. Save → ledger entries created → WAC recalculated → stock appears in branch.
**Edge:** expiry earlier than today (block), duplicate barcode (warn), price below WAC (warn, requires reason/permission).

## J3. Cashier bill (core flow – must be < 20 s)
1. Shift start (optional): opening cash.
2. Focus lands in search box; scan barcode → item added; qty via `+`/typing.
3. Optional: discount per item/bill (₹ or %). Within limit → applied. Over limit → "Needs approval" → admin enters PIN / approves on phone.
4. Optional: attach customer (scan membership QR or phone/email lookup) → points preview and eligible rewards.
5. `F9` Pay → choose cash/UPI/card/split → confirm.
6. Invoice created (server validates stock, price, discount, tax) → thermal print auto → WhatsApp button opens click-to-chat with invoice link.
**Success:** invoice number issued, stock decremented, COGS snapshotted, audit written.
**Edge:** barcode not found (quick search / request admin), insufficient stock (policy: block/warn), internet drops (bill queued, receipt shows "pending sync", invoice number from offline block, see architecture §8), printer offline (reprint/PDF), double-click pay (idempotency key).

## J4. Refund / cancellation (Cashier requests, Admin approves)
1. Find invoice → Return/Cancel → select lines, reason code.
2. If cashier lacks permission → approval request pushed to admin app/web.
3. Approved → credit note generated, stock returned (or damaged bucket), loyalty points reversed.
**Edge:** partial returns; return after points were redeemed; time-window limit.

## J5. Stock adjustment / transfer (Admin)
Adjustment: pick product → counted qty → reason (damage/expired/recount) → ledger entry + audit (who, before/after).
Transfer: from branch A to B → in-transit state → B confirms receipt → both ledgers updated; cost carried at A's WAC.

## J6. Owner daily check (mobile)
1. Open app → today's sales vs. yesterday, per branch.
2. Alerts: low stock (n), near expiry (n), pending approvals (n), suspicious discounts.
3. Tap branch → top products, margin (owner-only) → tap alert → resolve.

## J7. Create loyalty programme & offer (Owner)
1. Loyalty → set earn rule (e.g., 1 point per ₹100), redeem rule (100 points = ₹50), min spend, expiry (12 mo).
2. Create welcome offer (₹100 off ≥ ₹999), coupon code, exclusions (e.g., exclude already-discounted items).
3. Print shop QR poster (PDF) with join code.

## J8. Customer joins a shop
1. Install app → register (email+password) → verify email.
2. Join: scan shop QR / enter code / open signup link.
3. See shop card: welcome offer, points 0, membership QR.
4. At counter: shows QR → cashier scans → points credited after bill.
**Edge:** invalid/expired code, already member, shop suspended, customer joins second shop (separate balances).

## J9. Customer redeems reward
Points/coupon shown in app → cashier attaches membership → POS lists eligible rewards (server-evaluated) → apply → bill total drops → points deducted atomically with invoice.

## J10. Super Admin
Review new retailers → approve/trial → view usage (bills/day, branches, users) → handle failed payment (dunning list) → suspend (read-only/locked) → reactivate. Impersonation requires reason, is time-boxed (30 min), and is audit-logged and visible to the tenant.

## J11. Subscription lifecycle
Trial → active → payment fails (retry 3×, banner) → grace (7 days) → suspended (POS read-only, data kept) → reactivated on payment; cancel → export window 30 days → deletion schedule.

## J12. Forgot password / account recovery
Request → email link (single-use, 30 min) → set new password → all sessions revoked → security email sent.
