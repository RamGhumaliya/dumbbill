# ADR 004: Money is whole paise, calculated only on the server

- Status: Accepted (17 Oct 2026)
- Deciders: Owner, architect agent
- Related: `CLAUDE.md` hard rule 4, `docs/01-product/user-stories.md` US-POS-04, `docs/04-qa/test-plan.md` (money invariants), `docs/03-engineering/architecture.md` §7

## 1. Context

Dumbbill produces GST invoices. A wrong rupee or a missing paisa is a legal and trust problem, and a shop owner who sees totals that do not add up stops trusting the product. Decimal fractions stored as floating-point numbers (`0.1 + 0.2 = 0.30000000000000004`) cannot be used for money.

## 2. Decision

1. **Every amount is stored and calculated as a whole number of paise** (1 rupee = 100 paise). ₹499.50 is `49950`. Database columns are `bigint` (or `integer` where the range allows), named with a `_paise` suffix (`price_paise`, `total_paise`).
2. **Tax rates are stored in basis points** (1 basis point = 0.01%). GST 18% is `1800`; 5% is `500` (`gst_rate_bp`). Rates like 2.5% (the CGST half of 5%) are `250`.
3. **Quantities are whole numbers** for sale lines (assumption for v1: protein products are sold by the unit, not by weight). If loose-weight selling is ever needed, this ADR must be revisited first.
4. **No floating-point type is used anywhere money flows**, in the backend, web or mobile. The one allowed conversion is paise to a display string (`₹1,84,260.50`, Indian digit grouping), done at the screen edge and never fed back into a calculation.
5. **Only the server calculates.** Line prices, discounts, tax, round-off and totals are computed on the server from product ids, quantities and discount intent. Totals sent by a client are ignored. Web and mobile only display figures they receive.
6. **Rounding rules are explicit and tested:**
   - Tax is rounded to the nearest paisa **per line**, then the invoice gets a separate **round-off line** to the nearest rupee, never more than ₹0.50 (US-POS-04).
   - Bill-level discounts are split across lines pro-rata; the leftover paise from the split are given to lines by one fixed rule, so the same cart always gives the same result.
   - The exact tie-break rules (half-up rounding, which line receives the leftover paise) are fixed in P2-1 and written into the golden-file tests that the chartered accountant reviews. If the CA asks for a different rule, the golden files and this ADR change together.
   - Discount never makes a total below zero.
7. **The calculation code is pure functions** (`src/modules/pos/domain`): same input gives same output, no database, no clock. This is what makes golden-file tests and a CA review possible.
8. **Mathematical safeguards in tests (money invariants):** the sum of lines equals the invoice totals; round-off at most ₹0.50; the sum of ledger entries equals the stock level; the sum of cost of goods equals the inventory movement value. These run as property tests over many random carts.
9. **JSON carries paise as plain integers** with the field name ending in `_paise` (or `Paise` in camelCase DTOs). Values stay far inside JavaScript's safe integer range (about ₹90 trillion), so no big-number type is needed in the browser or app.

## 3. Consequences

Good:
- Totals always add up exactly; results are identical on every machine.
- Nothing a customer or cashier does in a client can change what is billed.
- The calculation can be reviewed by a chartered accountant as a small set of pure functions with golden examples.

Costs and caveats:
- Developers must remember the unit. The `_paise` suffix and the money formatter (`MoneyText` on web, `formatPaise` on mobile; both display only) exist to make mistakes visible.
- Percentages and averages (weighted-average cost, pro-rata discounts) need explicit integer rounding decisions; they are written down in ADR 007 and the domain code instead of left to chance.
- Values larger than the safe integer range would break JSON in JavaScript. Not a realistic risk for retail invoices; input validation will cap amounts well below it.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Floating-point numbers | Rounding errors; never acceptable for money. |
| Decimal / `numeric` database type with decimal strings | Correct, but every layer needs a decimal library and parsing, and it is easy to slip back into floats in JavaScript or Dart. Integers are simpler to get right. |
| Rupees as integers | Cannot hold paise, which are needed for tax per line. |
| Big-number library everywhere | Not needed at retail scale and adds weight on mobile and POS. |
