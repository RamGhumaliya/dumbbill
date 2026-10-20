# ADR 012: Purchasing, the stock ledger with weighted average cost, and the audit chain

- Status: Accepted (21 Oct 2026, implemented in P1-5)
- Deciders: Owner, architect agent
- Related: ADR 003 (RLS strategy), ADR 004 (money as paise), ADR 009 (permissions), ADR 011 (catalogue and pricing), user stories US-PUR-01, US-STK-01, US-STK-02, US-AUD-01, architecture sections 5 and 6, `docs/api/purchasing-and-stock.md`

## 1. Context

Stock and its cost decide every profit figure the owner will ever read, and they are the part of a shop's books people are most tempted to "fix by hand". Five things matter:

1. **The books must always add up.** Stock on hand must equal the sum of everything that ever moved it, and the value of that stock must equal the sum of the values that moved with it, to the paisa, whatever happens.
2. **Two people must not both sell the last unit.**
3. **A retry must not do the work twice.** A double tap or a dropped connection on "Save purchase" must not enter the bill twice.
4. **Cost is secret.** Cashiers may see how many are in stock, never what they cost.
5. **The audit log must be provably untouched.** "It cannot be edited" is a promise; the owner needs a way to check it.

## 2. Decision

### The stock ledger and costing

1. **One append-only ledger is the truth.** Every movement is a row in `stock_ledger` (type, quantity change, value change, who, why, which batch, what caused it). `stock_levels` (how many a branch holds, and what that is worth) is a **projection** of the ledger. The app role cannot UPDATE or DELETE ledger rows, and a trigger refuses the table owner too. A correction is a new row (a count, a supplier return).
2. **The value of stock is stored as a TOTAL, not as a per-unit cost.** A per-unit cost in whole paise has to be rounded, and rounding on every sale lets a small error build up. Instead a position remembers its exact total value. Taking `n` of `q` units removes `round(value x n / q)` paise; taking the last unit removes exactly what is left. The per-unit average shown on screens (value / quantity) is derived and rounded for display only. All costing is pure functions in `domain/costing.ts` using `BigInt` for money x quantity, with property tests.
3. **Weighted average cost (WAC), one per product per branch.** A purchase adds its LANDED value (supplier price plus a share of freight); a sale or any removal leaves at the current average, so the average of what remains is unchanged (within one paisa of rounding). A second purchase never rewrites an earlier one: each purchase only adds value, so two purchases at different prices keep both layers and the average is their weighted mean (US-PUR-01, tested).
4. **Landed cost.** Extra costs on a bill are spread over its lines in proportion to line value (quantity x unit price), in whole paise that always add up exactly (the largest-remainder method, ties to the earlier line); an all-free bill splits by quantity.
5. **Stock never goes below zero.** Asking for more than is on hand is `INSUFFICIENT_STOCK`, and a database check also forbids negative stock, so a bug cannot create it. A shop policy that allows negative stock arrives with the till (Phase 2).
6. **Batches for expiry; FEFO.** Every receipt goes into a batch (batch number + expiry date; the same pair at the same branch tops up the same batch; none means a shared "no batch" lot). Costing stays per product and branch, not per batch. Stock leaves the batch that expires first (batches without a date last), unless a batch is named. A movement touching several batches writes one ledger row per batch.
7. **One place changes stock.** `StockEngine` is the only code that writes the ledger or a level. Purchases, counts, transfers, returns, write-offs (and the till in Phase 2) all go through it, inside the caller's transaction, so the rules cannot differ between features.

### Concurrency

8. **Positions are locked before they are read** (`SELECT ... FOR UPDATE`), always in product-id order, so two requests for the last unit serialise (exactly one wins; the other gets `INSUFFICIENT_STOCK`) and two multi-product changes cannot deadlock. Tested with ten parallel requests for five units and with four parallel multi-product transfers in different orders.

### Purchases, returns and transfers

9. **A purchase is immutable.** It checks the supplier, branch, products, dates (expiry not in the past, invoice date not in the future) and that this supplier's invoice number is new (unique per supplier, ignoring case), then in ONE transaction allocates freight, adds each line to stock at its landed value and saves the bill. A mistake is corrected by a supplier return or a count, never by editing. A bill is capped at Rs 2 crore (per bill and per line), by the API and by a database check.
10. **Supplier returns create a numbered debit note** (`DN-0001`, counted per business without gaps, even when two requests ask at once). Stock leaves at its average cost; the credit recorded is what the supplier agreed per unit and lowers what the shop owes them. If any line has too little stock, nothing is saved, not even a number.
11. **What is owed to a supplier is computed, never stored**: their bills minus the credit on their debit notes. **Payments are not recorded yet**; the screen says so. (Phase 4 billing/ledger work or an earlier small story can add them.)
12. **Transfers are two steps.** SEND takes goods out of the sending branch at its average (ledger `TRANSFER_OUT`) and records the value on the transfer lines; the goods are "in transit", in NEITHER branch's stock. RECEIVE (receiving branch) brings them in at exactly that value, in the same batches; CANCEL (sending branch) returns them at that value. A transfer can be received or cancelled once: a row lock serialises two people acting at the same moment. The cost travels with the goods (the receiving branch's average becomes the sender's, then blends with later purchases).
13. **Counts and write-offs.** A count says "I counted N": the difference is recorded with a reason (recount, damage, lost, other); found units are valued at the current average (or, with no average yet, the cost given, the product's own cost, else nothing). Expired batches are written off at the average, and a batch that has NOT expired is refused (damaged goods use a count). Every count records the quantity before and after in the audit log.
14. **Alerts** (US-STK-02): low stock (a level per product and branch, 0 switches it off), batches expiring within the business's window (default 60 days, 1 to 365), batches already expired that still hold units. The **daily e-mail digest is not built**: it needs a job runner and a safe way to list all businesses from a background job, neither of which exists yet. The data is there for it (`GET /v1/stock/alerts`).
15. **Invariant checks.** `GET /v1/stock/verify` proves, for every position, that the level equals the sum of its ledger rows (quantity and value) and that the batches add up to the level. `POST /v1/stock/rebuild` (owner level) puts levels and batches right from the ledger after a fault. Both are tested, including a deliberately damaged level.

### Idempotency (hard rule 6)

16. **Every stock-changing or bill-creating POST needs an `Idempotency-Key` header** (8 to 100 letters, digits, dashes, underscores; a UUID is ideal): purchases, supplier returns, counts, write-offs, transfers. The key is claimed inside the SAME transaction as the work, so a failed attempt leaves nothing behind and the key stays usable; a repeat returns the saved answer (header `Idempotent-Replayed: true`); the same key with a different body is `IDEMPOTENCY_KEY_REUSED`; two attempts at the same instant make exactly one change (the unique key makes the second wait, then replay). Keys are per business and per operation. Old keys can be cleaned after a day or two by a later job.
17. **The web makes one key per form** and resends it on retry; a fresh form gets a fresh key.

### Cost secrecy (hard rule 3)

18. **Same pattern as P1-4: two response types.** `StockRowCashierDto` / `LedgerEntryDto` have no cost, value or average-cost field; the `...AdminDto` types add them and are returned only to people with `products.cost.read`. Purchases, suppliers and debit notes need `purchases.write` and show costs (the person entering a bill knows what it cost). Transfers show no value. A leak scanner covers every stock response a cashier can get, a person with `stock.adjust` but no cost access, and the written API contract.
19. **No amounts in the audit log.** Purchase, return and transfer entries carry counts and references, never money; a test searches the log for a distinctive cost.

### The audit log (US-AUD-01) and its chain

20. **The log now records the role** the person held at the time and, for changes that matter, the state **before and after** (a count's quantities, a setting). A viewer (`audit.read`) filters by event prefix, subject, person and time range.
21. **The hash chain.** Each audit row is "sealed" once, in order: its hash covers the row's content and the previous seal, so changing or removing any sealed row breaks its own hash and every later one, and `verify` names the first seal that fails. Sealing is separate from writing (audit rows are written inside concurrent business transactions; chaining at write time would make them queue). `seal` runs whenever the log is viewed or verified, one sealer at a time per business (an advisory lock); the chain's order is the order rows were sealed. The chain table is append-only like the log.
22. **Limits, stated plainly.** The chain detects changed or removed rows and a removed or reordered seal. It cannot stop someone who can rewrite BOTH the log and the chain and recompute every later hash; that needs the latest hash anchored somewhere the database owner cannot write (the plan: S3 Object Lock, when deployment exists). A row inserted directly and sealed later looks like a normal new entry, so tamper-evidence covers history, not forged additions.

## 3. Consequences

Good:
- The books are provably consistent: levels equal ledgers, batches equal levels, and a test, a check endpoint and a repair tool say so.
- The last unit cannot be sold twice; retries cannot double a bill; a failed request leaves no trace.
- Costs stay in two places only: the people who may see them, and the database.
- The audit log is checkable by its owner, not just "trusted".

Costs and caveats:
- **One extra lock round trip per stock change.** Fine at this scale; locking is per position, so different products never wait for each other.
- **Batches multiply ledger rows** when a movement spans batches (one row each). Intentional: the drilldown shows which batch lost units.
- **No supplier payments, no daily digest e-mail, no negative-stock policy yet** (above).
- **Seals are made lazily.** An audit row is unsealed until the log is next viewed or verified; the verify call reports how many are unsealed and seals them first.
- **The receiving branch of a transfer must be one the sender can list** in the web form (the API itself only needs it to exist and be switched on).
- **`idempotency_keys` grows** until a clean-up job exists.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Store a per-unit WAC and update it on every movement | Rounding on each sale accumulates; the value would drift from the ledger. A stored total cannot. |
| FIFO costing now | The architecture keeps costing behind a strategy swap; WAC is what the owner chose for Phase 1. Batches are tracked, so FIFO can come later without a data change. |
| Compute stock by summing the ledger on every read | Slow at scale and impossible to lock; a projection with a proof (verify/rebuild) is both fast and trustworthy. |
| Let sales go negative and fix later | Hides real problems and creates costs with no basis; refused until a shop-level policy exists. |
| Chain audit rows at write time | Serialises every business transaction behind one lock. Sealing afterwards is deterministic and cheap. |
| Idempotency by a middleware that caches responses | The key would be claimed outside the work's transaction: a crash between the two would either lose or duplicate the work. Claiming inside the transaction is atomic. |
| Edit a purchase to fix a mistake | Edits rewrite history that costs and profit already depend on; returns and counts leave a trail. |

## 5. How we know it works

- `test/unit/costing.spec.ts` (18) with fast-check property tests: a purchase gives the weighted mean and keeps every layer; a sale leaves the average unchanged within a paisa and removes its proportional share; the last unit takes exactly the remaining value; transfers create or lose no value; a return restores exactly what the sale removed; any run of purchases and sales keeps stock and value non-negative and the position equal to the sum of its movements; freight shares always add up exactly; very large stock stays exact.
- `test/integration/purchasing-flow.spec.ts` (26): suppliers (names, GSTIN check, isolation), purchases (stock at landed cost, both layers kept, freight shared to the paisa, batch top-up, expiry/date/size refusals, invoice number uniqueness, switched-off supplier/product/branch, all-or-nothing, listing and branch scope), **idempotency** (same key returns the same purchase, different body refused, three simultaneous attempts make one, a failed attempt does not burn the key, missing or malformed key, isolation between businesses), permissions, no amounts in the audit log, supplier returns (average cost, debit-note numbering without gaps, owed balance, insufficient stock saves nothing, named batch, retries), and the checklist steps.
- `test/integration/stock-flow.spec.ts` (33): cost secrecy for cashiers and for a person with `stock.adjust` but no cost access, plus the written contract; counts (before/after audit, valuation of found units, refusals, retries); FEFO and named batches; write-offs of expired batches only; alerts and settings; transfers (cost travels, in-transit, batches carried, cancel, double receive, simultaneous receive, branch rules); **the last unit race** (ten for five: exactly five succeed) and a four-way multi-product race without deadlock; the ledger invariant after a mix of every movement type; verify and rebuild on a damaged level; ledger immutability.
- `test/integration/audit-flow.spec.ts` (10): the viewer and its filters, permissions and isolation, sealing and verifying, concurrent viewers, and tamper detection (a changed entry, each field a reader cares about, a removed entry, a removed seal, and the chain itself being append-only), by switching off the database's own protection as an attacker with the owner password could.
- `test/security/inventory-db-security.spec.ts` (29): walls between businesses on 14 tables; the ledger and the chain refuse changes from the app role AND the table owner; negative stock, opposite-direction ledger rows, mismatched totals, duplicate invoice numbers and batches, impossible transfer states and debit-note totals are refused by the database.
- Route-by-role matrix, Swagger completeness and RLS coverage run over the 40 new routes and 14 new tables automatically.
- Web: 54 browser tests (real Chromium, pretend API) including axe in both themes on 11 screens, the spreadsheet purchase entry (live landed cost and average, Enter key flow, barcode scan, one key reused on retry), cost columns absent without cost access, and the picker race; unit tests for the preview maths, which shares worked examples with the server.
- A sabotage check broke 15 protections one at a time and the tests caught every one: cost shown in stock and ledger lists, stock allowed below zero, positions not locked, the wrong batch first, a purchase adding no value, retries not recognised, a reused key accepted, freight not spread, expired batches bought, costs in the audit log, unexpired batches written off, double receipt, branch scope on stock, and the chain not noticing a change.
- A live run with a real PostgreSQL, Redis, Mailpit and browser: a supplier with a typo in the GSTIN refused, a two-line purchase with freight shared (Rs 1,100 and Rs 3,300), the preview of a second purchase (10 held at Rs 110, 10 more at Rs 200 gives Rs 155), a count with before/after in the audit log, a transfer carrying its cost (6 units arrive worth 6 x Rs 155), verify OK, the audit check intact and then failing at the edited entry, one change from two identical-key requests, and a cashier whose stock answer has no cost-like word and who is refused the ledger, purchases, counts and the audit log.
