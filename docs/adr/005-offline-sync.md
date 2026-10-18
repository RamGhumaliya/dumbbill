# ADR 005: Offline-tolerant POS with a replay queue and leased invoice numbers

- Status: Accepted as design (17 Oct 2026). Built in P2-5; details may be refined there and recorded here.
- Deciders: Owner, architect agent
- Related: `docs/03-engineering/architecture.md` §8, US-POS-07, ADR 004, ADR 007

## 1. Context

Shop internet is unreliable. A cashier with a queue of customers cannot stop selling because the wifi dropped. But a bill is also a legal GST document: its number must be unique and gap-free per branch per financial year, and the prices, stock and tax on it must be right.

The product promise is **offline-tolerant**, not offline-first: selling keeps working for a limited time without internet, and everything is checked by the server when the connection returns.

## 2. Decision

1. **Web POS is a PWA.** A service worker keeps the app shell available offline. A **catalogue snapshot** (products, prices, tax rates, customer look-ups) is kept in IndexedDB and refreshed by a delta cursor (`updated_since`).
2. **Invoice numbers are leased in blocks.** While online, the server gives each terminal a block of 50 numbers for its branch and financial year. Offline sales take the next number from the block, so numbers stay unique and gap-free without talking to the server.
3. **An offline sale is a draft with its own idempotency key** (a UUID created on the device) and a number from the leased block. It is stored in an **encrypted** local queue (WebCrypto, key derived from the session), so a stolen device does not expose sales.
4. **On reconnect the queue replays first-in-first-out** to `POST /pos/invoices:sync`. The server treats each draft like a new checkout (ADR 004: it recalculates everything and ignores client totals) and answers one of:
   - `ACCEPTED`: stored as sent.
   - `ACCEPTED_WITH_ADJUSTMENT`: stored, but price or stock had drifted; flagged for the owner to review.
   - `REJECTED`: could not be stored; needs a manual fix.
   **Nothing is silently discarded.** The UI shows a resolution queue for anything not plain `ACCEPTED`.
5. **Because the idempotency key is unique, a replay that is sent twice (for example after a dropped connection mid-sync) creates only one invoice.**
6. **Limits protect correctness:** at most **24 hours or 200 offline bills**, whichever comes first, then selling is blocked until sync. Discounts above the cashier threshold, refunds and cancellations are **online-only**, because they need an approval and an up-to-date view.
7. **Printing is local**, so receipts still print offline. The tenant may choose to mark them "provisional" until synced.
8. **The mobile apps are not offline-selling clients.** They keep a drift cache for read-only screens only. Selling happens on the web POS.

## 3. Consequences

Good:
- A shop keeps selling through short outages, and every offline bill is revalidated by the server.
- Gap-free numbering survives offline use, which GST invoicing needs.
- A double replay cannot create a double bill.

Costs and caveats:
- An unused number in a leased block (the device died, the browser data was cleared) leaves a **gap**. Policy to settle in P2-5 with the CA: unused leased numbers are voided on the server with an audit record so the gap is explained, never silent.
- A price changed on the server while a device was offline can make an offline bill differ from what the customer was quoted. Handled by `ACCEPTED_WITH_ADJUSTMENT` and owner review, not hidden.
- The local encrypted queue is only as safe as the device's browser profile; the 24 h / 200 bills limit keeps the exposure small.
- This is the most complex feature in the product; it gets its own test set (offline throttling, duplicate replays, disconnect mid-sync, price drift).

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Online-only POS | Simple, but a wifi drop stops all sales in a shop. Unacceptable for the target retailers. |
| Fully offline-first with a local database as the source of truth | Conflicts on stock, prices and numbering become the normal case; much more complex and riskier for tax documents. |
| Client chooses its own invoice numbers (no leasing) | Collisions and gaps across terminals; breaks GST numbering rules. |
| Discarding bills that conflict on sync | Loses real sales. Rejected: every bill is kept and resolved by a person. |
