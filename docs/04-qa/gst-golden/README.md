# GST golden files (bill calculator)

For the chartered accountant (CA) and for developers. `cases.json` lists carts with the exact answer for each. The backend (`dumbbill-backend/src/modules/pos/domain`) and the web app's offline preview (`dumbbill-web/src/lib/pos`) must reproduce every answer to the paisa. User story: US-POS-04. Why money is whole paise: `docs/adr/004-money-as-paise.md`. The design of the calculator: `docs/adr/013-bill-calculator.md`.

**Status: waiting for CA review** (open question 4 in `docs/07-open-questions.md`). Nothing here may be used for a real invoice until the CA has signed it off.

## How to read a case

- Amounts are in **paise** (Rs 1 = 100 paise): `299900` is Rs 2,999.00.
- Rates are in **basis points** (1% = 100): `1800` is 18%, `500` is 5%.
- `TAX_INCLUSIVE` means the shelf price already contains the GST (how MRPs work). `TAX_EXCLUSIVE` means GST is added on top.
- `INTRA_STATE` is a sale inside the shop's own state (CGST + SGST); `INTER_STATE` is another state (IGST).
- `TAX_INVOICE` is for a GST-registered business; `BILL_OF_SUPPLY` is for one that is not (no tax at all).

## The rules the answers follow

1. Gross of a line = quantity x unit price.
2. The line's own discount comes off (a percentage is rounded to the nearest paisa, **an exact half rounds up**; an amount cannot exceed the line).
3. The bill discount comes off the whole bill and is shared between the lines **in proportion to what each line has left**. Whole paise are shared out first; the few paise left over go one each to the lines with the biggest fractional part, **the earlier line winning a tie**. Shares always add up to the discount exactly.
4. Tax is worked out **per line** on what the line has left:
   - inclusive: taxable value = amount x 10000 / (10000 + rate), rounded half up; tax = amount - taxable value.
   - exclusive: tax = amount x rate / 10000, rounded half up.
5. Same-state tax is split **CGST = half rounded down, SGST = the rest**, so SGST is never smaller and they differ by at most one paisa. Other-state tax is all IGST.
6. The invoice total is the sum of the line totals **rounded to the nearest rupee (half up)**. The difference is a separate **round-off** line (between -49 and +50 paise).
7. The HSN summary adds up quantity, taxable value and tax per HSN code and rate.

## Questions for the CA

1. Are the rounding choices in rules 2, 3, 4 and 6 acceptable (half up; per line; round-off to the rupee)?
2. Rule 5: is "CGST gets the smaller half" acceptable when the tax is an odd number of paise, or should the invoice total be adjusted so both are equal?
3. Is a bill-level discount allowed to be shared across lines of different rates this way (it changes the taxable value of each line), and should the invoice show the discount before or after tax?
4. Are the carts realistic? Which common carts are missing?
5. The rate list the product allows is 0%, 0.25%, 3%, 5%, 18% and 40% (after the September 2025 reform). Please confirm it, and the HSN codes used in these examples (they are samples).

## Keeping the copies in step

Edit `generate_golden.py`, run `python generate_golden.py`, then copy `cases.json` to `dumbbill-web/tests/fixtures/gst-golden/cases.json`. A backend unit test fails when the two copies differ.
