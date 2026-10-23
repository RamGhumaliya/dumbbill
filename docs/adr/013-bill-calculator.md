# ADR 013: The bill calculator (pricing, discounts, GST) as pure functions

- Status: Accepted, **rounding rules waiting for the chartered accountant's (CA) review** (17 Oct 2026 plan, built 23 Oct 2026)
- Deciders: Owner, backend-dev agent
- Related: `docs/adr/004-money-as-paise.md`, `docs/01-product/user-stories.md` US-POS-02 and US-POS-04, `docs/04-qa/gst-golden/`, `docs/03-engineering/architecture.md` section 7

## 1. Context

Every invoice depends on one calculation: from a cart (products, quantities, discounts) to line figures, tax, round-off and a total. It must give the same answer on the server, in the web till (for a live preview and offline billing) and, later, on the phone. A shop owner and the CA must be able to check it by hand. ADR 004 fixed the principles (whole paise, server decides); this ADR fixes the exact steps and rounding choices that ADR 004 left to P2-1.

## 2. Decision

1. The calculator is **pure functions** in `dumbbill-backend/src/modules/pos/domain/` (`pricing.ts`, `discount-limit.ts`, `rounding.ts`): no database, no clock, no randomness. The checkout (P2-2) reads the catalogue and the business, builds a `BillInput`, calls `calculateBill`, and stores the answer. A client's totals are never read.
2. **The steps, in order:** gross of a line, item discount, bill discount shared across lines, net, tax per line, split of the tax, invoice total with a separate round-off line. The wording of each step is in the file comment of `pricing.ts` and in `docs/04-qa/gst-golden/README.md`.
3. **Rounding:** every division rounds **once, to the nearest paisa, with an exact half rounded up**. The invoice total is rounded to the nearest **rupee**, half up, and the difference is a separate round-off line between -49 and +50 paise.
4. **Sharing a bill discount:** in proportion to what each line has left after its own discount. Whole paise first, then the leftover paise one each to the biggest fractional remainders, **the earlier line winning a tie** (largest remainder method). The shares add up to the discount exactly and never exceed a line.
5. **Tax per line, on the net.** Inclusive prices: taxable value = net x 10000 / (10000 + rate), tax = net - taxable value (so the customer pays exactly the shelf price). Exclusive prices: tax = net x rate / 10000.
6. **Splitting the tax:** same state, CGST = tax / 2 rounded **down**, SGST = the rest (SGST is never smaller; they differ by at most one paisa). Another state, all IGST. The place of supply of a counter sale is the shop's state unless the customer's state is known and different.
7. **Tax invoice or bill of supply:** a bill of supply (a business with no GSTIN) carries **no tax at all**, whatever rate the product has; its taxable value equals the net.
8. **Discount limit** (`checkDiscountLimit`): a person's limit (basis points) is checked on the server's own figures, on (a) the whole bill's discount against the gross total and (b) each line's _own_ discount against that line, with the allowance rounded up to the next paisa. A line's share of a bill-level discount is not checked on its own, so rounding cannot trip a limit. Anything over needs a manager's approval (checkout, P2-2).
9. **Limits:** quantity 1 to 100,000 a line; unit price up to Rs 1 crore; at most 200 lines; a bill up to Rs 10 crore before discounts. Larger numbers are refused, which also keeps every figure far inside what a JavaScript number holds exactly. Multiplications use BigInt.
10. **A golden file** (`docs/04-qa/gst-golden/cases.json`, 15 carts) holds carts with their exact answers. The answers come from an **independent** script (`generate_golden.py`, exact fractions, written from the rules), not from the code under test. The backend and the web preview (`dumbbill-web/src/lib/pos/pricing.ts`, a hand-written mirror) must both reproduce every figure; a backend test fails when the web copy of the file differs.
11. **Property tests** (fast-check) hold for any cart: every figure is a whole non-negative number of paise; lines add up to the bill; taxable + tax = line total; total = subtotal + round-off; discounts never exceed what they come off; shares add up exactly; bill of supply has no tax; HSN summary adds up to the bill.

## 3. Consequences

Good: the same cart gives the same bill everywhere; the CA reviews a short list of carts instead of code; offline billing and the server agree by construction and by test.

Costs and caveats:

- The web mirror is a second copy of the logic. Drift is caught by the shared golden file, not by the compiler.
- **Unconfirmed by a CA:** half-up rounding, tax per line (not per invoice), CGST taking the smaller half, a bill-level discount changing each line's taxable value, round-off to the rupee. If the CA asks for another rule, change `generate_golden.py`, regenerate, then the code and this ADR.
- Prices are assumed whole rupees-and-paise per unit; selling by weight is not supported (ADR 004).
- The price basis (inclusive or exclusive) is an input; the business setting that chooses it is added with the checkout.

## 4. Alternatives considered

| Option                                                   | Why not                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Tax per invoice (one rate-group sum) instead of per line | Per-line rounding is what the invoice lists and the HSN summary must add up to; it also makes a returned line's tax well defined. |
| Make CGST and SGST always equal by adjusting the total   | Changes what the customer pays by a paisa; needs a CA decision. Raised as a question in the golden README.                        |
| Floating point with a final rounding                     | Rounding errors; rejected by ADR 004.                                                                                             |
| Compute the preview on the server too                    | Offline billing needs a local calculation.                                                                                        |
