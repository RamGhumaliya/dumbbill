# ADR 007: Weighted-average costing, with a ledger that can be rebuilt

- Status: Accepted (17 Oct 2026). Built in P1-5.
- Deciders: Owner, architect agent
- Related: `docs/03-engineering/architecture.md` §5, §6, ADR 004, `CLAUDE.md` hard rules 3 and 5

## 1. Context

The owner needs to know profit, not just sales. That needs the **cost** of every item sold. A protein tub bought at ₹2,000 last month and ₹2,200 this month has no single "true" cost, so the business must pick a costing method and apply it the same way every time. The choice also affects reports the owner may show to an accountant.

Cost and profit are secret from cashiers (hard rule 3), so they must be stored and exposed carefully as well.

## 2. Decision

1. **Method: weighted-average cost (WAC), per product per branch**, decided by the owner.
2. **Stock is an append-only ledger.** Table `stock_ledger` records every movement (purchase, sale, return, adjustment, transfer, write-off) with `qty_delta`, the unit cost, and `wac_after`. Rows are never updated or deleted; corrections are new reversing rows (hard rule 5). The app role has no UPDATE or DELETE on it (ADR 003).
3. **`stock_levels` is a projection** (current quantity and WAC per branch and product), kept in step with the ledger inside the same transaction and **always rebuildable from the ledger**.
4. **On a purchase:** `new_wac = (old_qty × old_wac + in_qty × landed_unit_cost) ÷ (old_qty + in_qty)`. The landed unit cost is the supplier price plus its share of freight and other costs on the purchase (allocated across lines). The result is stored on the ledger row.
5. **On a sale:** the cost of the item is the **current WAC**. WAC does not change on a sale. The cost is **copied onto the invoice line** (`cost_at_sale_paise`) so past profit never changes when later purchases change the average.
6. **On a sale return:** the item goes back at its **original `cost_at_sale`**, not today's WAC, so profit reverses exactly.
7. **On a transfer between branches:** out at the source branch's WAC, in at the same cost at the destination.
8. **Negative stock is a tenant policy:** default `BLOCK` (the owner decided: block a sale at zero stock). If a tenant chooses to allow it, the sale is costed at the last known WAC and flagged.
9. **Integer rounding (ADR 004):** WAC is stored in whole paise and rounded to the nearest paisa when computed. Because rounding can drift by a paisa over many purchases, the nightly check compares **quantities exactly** and **inventory value within a tiny tolerance**, and the cost of goods sold is the value stored on each invoice line, so reports always add up to what was billed.
10. **Concurrency:** stock changes lock the `stock_levels` row (`SELECT ... FOR UPDATE`), taking locks in a fixed order (by product id) so two checkouts cannot deadlock.
11. **Integrity checks:** a rebuild job and a nightly invariant check assert that the sum of ledger quantities equals `stock_levels` for every branch and product. A mismatch raises an alert.
12. **Costing is a swappable strategy** behind a `CostingStrategy` interface. Weighted average is the only implementation in v1; first-in-first-out could be added later without changing callers.
13. **Batches and expiry** are tracked per purchase line (`batch_no`, `expiry_date`) for expiry alerts, but **costing stays at product + branch level**, not per batch.
14. **Secrecy:** WAC, unit cost, cost at sale and profit never appear in cashier-audience responses. Separate DTO types exist and a contract test checks it; logs redact these fields (observability.md §2).

## 3. Consequences

Good:
- Profit per sale is fixed at the moment of sale and never silently changes.
- Stock can be audited and rebuilt from the ledger; there is no hidden mutation.
- Simple for an owner to understand: "average of what I paid".

Costs and caveats:
- WAC hides price swings: a very cheap early lot lowers the average for a long time. That is how the method works; reports show it plainly.
- A wrong purchase entry is corrected with a reversing entry, not an edit, which is more steps but keeps the audit trail honest.
- A backdated purchase changes the average from that point only for **future** sales; it does not rewrite past invoice costs. The owner is told this in the UI.
- The ledger grows without limit; it is partitioned by month once it passes about 50 million rows (architecture §5).
- Whether Indian accounting for the owner's CA accepts weighted-average for the books is something the CA confirms (open question 4); the method is a standard one and is permitted.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| FIFO (oldest cost first) | Needs a cost layer per batch and gets complicated with returns and transfers. Kept as a future strategy swap. |
| Last purchase price | Simple but makes past profit jump when a new lot arrives. |
| Standard / fixed cost | Not how small retailers think; would need constant manual updates. |
| Mutable stock quantity column only | Fast but cannot be audited or rebuilt, and mistakes are invisible. |
