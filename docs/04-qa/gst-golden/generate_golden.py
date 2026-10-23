"""
Generates cases.json, the GOLDEN FILE for the Dumbbill bill calculator (US-POS-04).

WHY THIS EXISTS
A "golden file" is a list of carts with the exact answer written next to each one. The backend and the web app both
run every cart through their own calculator and must give exactly this answer. A chartered accountant (CA) reviews the
carts and answers here; if the CA wants a different rounding rule, change THIS file's rules, regenerate, and the code and
tests follow.

WHY IT IS WRITTEN SEPARATELY, IN PYTHON
The expected answers must not come from the code being tested. This script re-implements the rules from the written
description (README.md) using exact fractions, so a mistake in the TypeScript calculator cannot hide by being copied
into its own expectations.

HOW TO USE
    python generate_golden.py            # rewrites cases.json next to this file
Then copy cases.json into dumbbill-web/tests/fixtures/gst-golden/ (a backend test fails if the two copies differ).

All amounts are whole paise (Rs 1 = 100 paise); rates are basis points (1800 = 18%).
"""
import json
import pathlib
from fractions import Fraction
from math import floor


def half_up(numerator, denominator):
    """numerator / denominator rounded to the nearest whole number; an exact half goes UP."""
    return floor(Fraction(numerator, denominator) + Fraction(1, 2))


def allocate(total, weights):
    """Share `total` over `weights` so the shares add up exactly (largest remainder; earlier line wins a tie)."""
    if total == 0:
        return [0] * len(weights)
    weight_sum = sum(weights)
    exact = [Fraction(total * w, weight_sum) for w in weights]
    shares = [floor(x) for x in exact]
    leftover = total - sum(shares)
    order = sorted(range(len(weights)), key=lambda i: (-(exact[i] - shares[i]), i))
    for i in order[:leftover]:
        shares[i] += 1
    return shares


def discount_amount(discount, base):
    if not discount:
        return 0
    if discount["kind"] == "PERCENT":
        return half_up(base * discount["basisPoints"], 10000)
    assert discount["paise"] <= base, "discount larger than the amount"
    return discount["paise"]


def price(cart):
    lines = cart["lines"]
    gross = [l["qty"] * l["unitPricePaise"] for l in lines]
    item = [discount_amount(l.get("discount"), g) for l, g in zip(lines, gross)]
    after_item = [g - d for g, d in zip(gross, item)]
    bill_total_discount = discount_amount(cart.get("billDiscount"), sum(after_item))
    shares = allocate(bill_total_discount, after_item)

    priced = []
    for l, g, i, a, s in zip(lines, gross, item, after_item, shares):
        net = a - s
        rate = 0 if cart["documentType"] == "BILL_OF_SUPPLY" else l["gstRateBp"]
        if cart["documentType"] == "BILL_OF_SUPPLY":
            taxable, tax = net, 0
        elif cart["priceBasis"] == "TAX_INCLUSIVE":
            taxable = half_up(net * 10000, 10000 + rate)
            tax = net - taxable
        else:
            taxable = net
            tax = half_up(net * rate, 10000)
        if cart["supply"] == "INTER_STATE":
            cgst, sgst, igst = 0, 0, tax
        else:
            cgst = tax // 2  # CGST gets the smaller half; SGST gets the rest
            sgst, igst = tax - cgst, 0
        priced.append(
            {
                "grossPaise": g,
                "itemDiscountPaise": i,
                "billDiscountPaise": s,
                "netPaise": net,
                "taxableValuePaise": taxable,
                "gstRateBp": rate,
                "cgstPaise": cgst,
                "sgstPaise": sgst,
                "igstPaise": igst,
                "taxPaise": tax,
                "totalPaise": taxable + tax,
            }
        )

    def total_of(key):
        return sum(p[key] for p in priced)

    subtotal = total_of("totalPaise")
    total = half_up(subtotal, 100) * 100

    hsn_rows = {}
    for l, p in zip(lines, priced):
        key = (l.get("hsn") or "", p["gstRateBp"])
        row = hsn_rows.setdefault(
            key,
            {
                "hsn": key[0],
                "gstRateBp": key[1],
                "qty": 0,
                "taxableValuePaise": 0,
                "cgstPaise": 0,
                "sgstPaise": 0,
                "igstPaise": 0,
                "taxPaise": 0,
            },
        )
        row["qty"] += l["qty"]
        for k in ("taxableValuePaise", "cgstPaise", "sgstPaise", "igstPaise", "taxPaise"):
            row[k] += p[k]

    return {
        "documentType": cart["documentType"],
        "priceBasis": cart["priceBasis"],
        "supply": cart["supply"],
        "lines": priced,
        "grossPaise": total_of("grossPaise"),
        "itemDiscountPaise": total_of("itemDiscountPaise"),
        "billDiscountPaise": total_of("billDiscountPaise"),
        "discountPaise": total_of("itemDiscountPaise") + total_of("billDiscountPaise"),
        "taxableValuePaise": total_of("taxableValuePaise"),
        "cgstPaise": total_of("cgstPaise"),
        "sgstPaise": total_of("sgstPaise"),
        "igstPaise": total_of("igstPaise"),
        "taxPaise": total_of("taxPaise"),
        "subtotalPaise": subtotal,
        "roundOffPaise": total - subtotal,
        "totalPaise": total,
        "hsnSummary": [hsn_rows[k] for k in sorted(hsn_rows)],
    }


def line(hsn, rate, qty, unit, discount=None):
    entry = {"hsn": hsn, "gstRateBp": rate, "qty": qty, "unitPricePaise": unit}
    if discount:
        entry["discount"] = discount
    return entry


def percent(basis_points):
    return {"kind": "PERCENT", "basisPoints": basis_points}


def amount(paise):
    return {"kind": "AMOUNT", "paise": paise}


def cart(document, basis, supply, lines, bill_discount=None):
    result = {"documentType": document, "priceBasis": basis, "supply": supply, "lines": lines}
    if bill_discount:
        result["billDiscount"] = bill_discount
    return result


TAX = "TAX_INVOICE"
INC = "TAX_INCLUSIVE"
EXC = "TAX_EXCLUSIVE"
SAME = "INTRA_STATE"
OTHER = "INTER_STATE"

WHEY = "21069099"  # protein supplement preparations
BAR = "19059090"  # protein bars and bakery-type goods
SHAKER = "39241090"  # plastic shaker bottles
APPAREL = "61091000"  # cotton t-shirts

CASES = [
    ("Whey 2 kg at Rs 2,999 inclusive of 18% GST, same state (the everyday sale)",
     cart(TAX, INC, SAME, [line(WHEY, 1800, 1, 299900)])),
    ("Two shaker bottles at Rs 1,000 each, GST 18% added on top, same state",
     cart(TAX, EXC, SAME, [line(SHAKER, 1800, 2, 100000)])),
    ("Three protein bars at Rs 499 inclusive of 5% GST, same state (odd paisa in the tax goes to SGST)",
     cart(TAX, INC, SAME, [line(BAR, 500, 3, 49900)])),
    ("Same whey sale to a customer in another state: one IGST instead of CGST + SGST",
     cart(TAX, INC, OTHER, [line(WHEY, 1800, 1, 299900)])),
    ("Two wheys with 10% off the line, inclusive 18%",
     cart(TAX, INC, SAME, [line(WHEY, 1800, 2, 299900, percent(1000))])),
    ("Rs 150 off the whole bill shared over a 5% line and two 18% lines (leftover paise rule)",
     cart(TAX, INC, SAME,
          [line(BAR, 500, 1, 49900), line(WHEY, 1800, 1, 299900), line(SHAKER, 1800, 2, 34900)],
          amount(15000))),
    ("7.5% off the whole bill over four lines, GST added on top",
     cart(TAX, EXC, SAME,
          [line(WHEY, 1800, 1, 249900), line(BAR, 500, 4, 12000), line(SHAKER, 1800, 1, 29900),
           line(APPAREL, 500, 2, 59900)],
          percent(750))),
    ("Bill of supply from a shop not registered for GST: rates are ignored, no tax",
     cart("BILL_OF_SUPPLY", INC, SAME, [line(None, 1800, 1, 299900), line(None, 500, 3, 49900)])),
    ("Round-off up: a total ending in exactly 50 paise rounds UP to the rupee",
     cart(TAX, INC, SAME, [line(SHAKER, 0, 1, 10050)])),
    ("Round-off down: a total ending in 49 paise rounds DOWN",
     cart(TAX, INC, SAME, [line(SHAKER, 0, 1, 10049)])),
    ("A 0% line and a 5% line on one bill",
     cart(TAX, INC, SAME, [line(APPAREL, 0, 1, 19900), line(BAR, 500, 2, 24900)])),
    ("A line given away free (100% off) next to a paid line",
     cart(TAX, INC, SAME, [line(SHAKER, 1800, 1, 24900, percent(10000)), line(WHEY, 1800, 1, 199900)])),
    ("Two lines sharing an HSN code and rate are one row of the HSN summary",
     cart(TAX, INC, SAME,
          [line(WHEY, 1800, 1, 299900), line(BAR, 500, 2, 49900), line(WHEY, 1800, 2, 149900)])),
    ("Tax of an odd number of paise: CGST 240, SGST 241",
     cart(TAX, INC, SAME, [line(BAR, 500, 1, 10100)])),
    ("Item discounts and a bill percentage together on six lines",
     cart(TAX, INC, SAME,
          [line(WHEY, 1800, 1, 299900, percent(500)), line(WHEY, 1800, 1, 189900),
           line(BAR, 500, 6, 7500, amount(1000)), line(SHAKER, 1800, 3, 19900),
           line(APPAREL, 500, 1, 79900, percent(1500)), line(BAR, 500, 1, 4900)],
          percent(250))),
]

if __name__ == "__main__":
    out = [{"name": name, "input": c, "expected": price(c)} for name, c in CASES]
    path = pathlib.Path(__file__).with_name("cases.json")
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"Wrote {len(out)} cases to {path}")
