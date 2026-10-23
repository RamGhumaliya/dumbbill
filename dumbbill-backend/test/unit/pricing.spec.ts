import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDiscountLimit } from '../../src/modules/pos/domain/discount-limit';
import {
  BillInput,
  calculateBill,
  Discount,
  LineInput,
  PricingError,
  supplyKind,
} from '../../src/modules/pos/domain/pricing';
import {
  allocateProRata,
  divideRoundHalfUp,
  divideRoundUp,
} from '../../src/modules/pos/domain/rounding';

/**
 * The bill calculator decides every rupee on every invoice, so it is tested three ways:
 *  1. GOLDEN FILE: carts with answers written independently (docs/04-qa/gst-golden/generate_golden.py) that a chartered
 *     accountant reviews. The calculator must reproduce every figure to the paisa.
 *  2. PROPERTIES: rules that must hold for ANY cart fast-check can invent (totals add up, nothing negative, discounts never
 *     exceed what they come off, shares add up exactly).
 *  3. WORKED EXAMPLES for the rounding and sharing helpers and the discount limit.
 */

const GOLDEN_DIR = join(__dirname, '../../../docs/04-qa/gst-golden');
const WEB_COPY = join(__dirname, '../../../dumbbill-web/tests/fixtures/gst-golden/cases.json');

type Bill = ReturnType<typeof calculateBill>;

interface GoldenCase {
  name: string;
  input: BillInput;
  expected: unknown;
}
const golden: GoldenCase[] = JSON.parse(readFileSync(join(GOLDEN_DIR, 'cases.json'), 'utf8'));

describe('golden file (US-POS-04)', () => {
  it('has the carts the CA reviews', () => {
    expect(golden.length).toBeGreaterThanOrEqual(15);
  });

  it.each(golden.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(calculateBill(c.input)).toEqual(c.expected);
  });

  it('the web app copy of the golden file is identical (so both calculators are held to the same answers)', () => {
    expect(readFileSync(WEB_COPY, 'utf8').replace(/\r\n/g, '\n')).toBe(
      readFileSync(join(GOLDEN_DIR, 'cases.json'), 'utf8').replace(/\r\n/g, '\n'),
    );
  });
});

describe('rounding helpers', () => {
  it('rounds halves up and everything else to the nearest', () => {
    expect(divideRoundHalfUp(7n, 2n)).toBe(4n); // 3.5 -> 4
    expect(divideRoundHalfUp(10n, 4n)).toBe(3n); // 2.5 -> 3
    expect(divideRoundHalfUp(9n, 4n)).toBe(2n); // 2.25 -> 2
    expect(divideRoundHalfUp(0n, 7n)).toBe(0n);
    expect(divideRoundUp(7n, 2n)).toBe(4n);
    expect(divideRoundUp(8n, 2n)).toBe(4n);
    expect(divideRoundUp(0n, 5n)).toBe(0n);
  });

  it('shares a total in proportion, leftover paise to the biggest remainders, earlier line on a tie', () => {
    // 100 over three equal lines: 33 each, one paisa left, equal remainders -> the first line.
    expect(allocateProRata(100n, [10n, 10n, 10n])).toEqual([34n, 33n, 33n]);
    // 10 over weights 1:2:3 -> exact 1.67, 3.33, 5.00 -> floors 1,3,5 (sum 9), the leftover goes to the biggest remainder.
    expect(allocateProRata(10n, [1n, 2n, 3n])).toEqual([2n, 3n, 5n]);
    expect(allocateProRata(0n, [5n, 5n])).toEqual([0n, 0n]);
  });

  it('never gives anything to a line with no weight, and refuses to share between nothing', () => {
    expect(allocateProRata(7n, [0n, 5n, 0n])).toEqual([0n, 7n, 0n]);
    expect(() => allocateProRata(1n, [0n, 0n])).toThrow(RangeError);
  });
});

describe('the rules, by example', () => {
  const base = (lines: LineInput[], extra: Partial<BillInput> = {}): BillInput => ({
    documentType: 'TAX_INVOICE',
    priceBasis: 'TAX_INCLUSIVE',
    supply: 'INTRA_STATE',
    lines,
    ...extra,
  });
  const whey: LineInput = { hsn: '21069099', gstRateBp: 1800, qty: 1, unitPricePaise: 299_900 };

  it('inclusive price: the customer pays the shelf price and the tax is carved out of it', () => {
    const bill = calculateBill(base([whey]));
    expect(bill.totalPaise).toBe(299_900);
    expect(bill.taxableValuePaise + bill.taxPaise).toBe(299_900);
  });

  it('exclusive price: the tax is added on top', () => {
    const bill = calculateBill(
      base([{ ...whey, unitPricePaise: 100_000 }], { priceBasis: 'TAX_EXCLUSIVE' }),
    );
    expect(bill.taxPaise).toBe(18_000);
    expect(bill.totalPaise).toBe(118_000);
  });

  it('a bill of supply charges no tax even if the product carries a rate', () => {
    const bill = calculateBill(base([whey], { documentType: 'BILL_OF_SUPPLY' }));
    expect(bill.taxPaise).toBe(0);
    expect(bill.lines[0]?.gstRateBp).toBe(0);
    expect(bill.totalPaise).toBe(299_900);
  });

  it('a sale in another state is all IGST', () => {
    const bill = calculateBill(base([whey], { supply: 'INTER_STATE' }));
    expect(bill.cgstPaise + bill.sgstPaise).toBe(0);
    expect(bill.igstPaise).toBe(bill.taxPaise);
  });

  it('CGST never exceeds SGST and they differ by at most one paisa', () => {
    const bill = calculateBill(base([{ ...whey, unitPricePaise: 10_100, gstRateBp: 500 }]));
    expect([bill.cgstPaise, bill.sgstPaise]).toEqual([240, 241]);
  });

  it('place of supply: the shop state unless the customer is known to be elsewhere', () => {
    expect(supplyKind('27')).toBe('INTRA_STATE');
    expect(supplyKind('27', null)).toBe('INTRA_STATE');
    expect(supplyKind('27', '27')).toBe('INTRA_STATE');
    expect(supplyKind('27', '29')).toBe('INTER_STATE');
  });

  it('the same cart always gives the same answer, however the work is repeated', () => {
    const cart = base([whey, { ...whey, qty: 3, unitPricePaise: 49_900, gstRateBp: 500 }], {
      billDiscount: { kind: 'AMOUNT', paise: 12_345 },
    });
    expect(calculateBill(cart)).toEqual(calculateBill(JSON.parse(JSON.stringify(cart))));
  });
});

describe('carts that cannot be priced', () => {
  const ok: LineInput = { hsn: null, gstRateBp: 500, qty: 1, unitPricePaise: 10_000 };
  const cart = (lines: LineInput[], billDiscount?: Discount): BillInput => ({
    documentType: 'TAX_INVOICE',
    priceBasis: 'TAX_INCLUSIVE',
    supply: 'INTRA_STATE',
    lines,
    ...(billDiscount ? { billDiscount } : {}),
  });
  const codeOf = (input: BillInput): string | undefined => {
    try {
      calculateBill(input);
    } catch (error) {
      return error instanceof PricingError ? error.code : 'OTHER';
    }
    return undefined;
  };

  it.each([
    ['an empty cart', cart([]), 'EMPTY_CART'],
    ['a zero quantity', cart([{ ...ok, qty: 0 }]), 'INVALID_QUANTITY'],
    ['a fractional quantity', cart([{ ...ok, qty: 1.5 }]), 'INVALID_QUANTITY'],
    ['a negative price', cart([{ ...ok, unitPricePaise: -1 }]), 'INVALID_AMOUNT'],
    ['a fractional price', cart([{ ...ok, unitPricePaise: 10.5 }]), 'INVALID_AMOUNT'],
    ['a rate above 100%', cart([{ ...ok, gstRateBp: 10_001 }]), 'INVALID_RATE'],
    [
      'an item discount above 100%',
      cart([{ ...ok, discount: { kind: 'PERCENT', basisPoints: 10_001 } }]),
      'INVALID_DISCOUNT',
    ],
    [
      'an item discount larger than the line',
      cart([{ ...ok, discount: { kind: 'AMOUNT', paise: 10_001 } }]),
      'DISCOUNT_EXCEEDS_AMOUNT',
    ],
    [
      'a bill discount larger than what is left',
      cart([ok], { kind: 'AMOUNT', paise: 10_001 }),
      'DISCOUNT_EXCEEDS_AMOUNT',
    ],
    ['a negative discount amount', cart([ok], { kind: 'AMOUNT', paise: -5 }), 'INVALID_DISCOUNT'],
    [
      'a bill beyond the size limit',
      cart([{ ...ok, qty: 100_000, unitPricePaise: 1_000_000_000 }]),
      'INVALID_AMOUNT',
    ],
    ['too many lines', cart(Array.from({ length: 201 }, () => ok)), 'TOO_MANY_LINES'],
  ])('refuses %s', (_name, input, code) => {
    expect(codeOf(input)).toBe(code);
  });

  it('accepts a discount of exactly the whole amount (a free bill)', () => {
    const bill = calculateBill(cart([ok], { kind: 'AMOUNT', paise: 10_000 }));
    expect(bill.totalPaise).toBe(0);
    expect(bill.lines[0]?.netPaise).toBe(0);
  });
});

describe('invariants for any cart (ADR 004 money invariants)', () => {
  const discount = fc.option(
    fc.oneof(
      fc.record({
        kind: fc.constant('PERCENT' as const),
        basisPoints: fc.integer({ min: 0, max: 10_000 }),
      }),
      fc.record({
        kind: fc.constant('AMOUNT' as const),
        paise: fc.integer({ min: 0, max: 50_000 }),
      }),
    ),
    { nil: undefined },
  );
  const line = fc.record({
    hsn: fc.option(fc.constantFrom('21069099', '19059090', '39241090', '61091000'), { nil: null }),
    gstRateBp: fc.constantFrom(0, 25, 300, 500, 1800, 4000),
    qty: fc.integer({ min: 1, max: 50 }),
    unitPricePaise: fc.integer({ min: 0, max: 5_000_000 }),
    discount,
  });
  const cart = fc.record({
    documentType: fc.constantFrom('TAX_INVOICE' as const, 'BILL_OF_SUPPLY' as const),
    priceBasis: fc.constantFrom('TAX_INCLUSIVE' as const, 'TAX_EXCLUSIVE' as const),
    supply: fc.constantFrom('INTRA_STATE' as const, 'INTER_STATE' as const),
    lines: fc.array(line, { minLength: 1, maxLength: 12 }),
    billDiscount: discount,
  });

  /** Price a generated cart, or return null when the generator happened to ask for an impossible discount. */
  const priced = (input: BillInput) => {
    try {
      return calculateBill(input);
    } catch (error) {
      if (error instanceof PricingError && error.code === 'DISCOUNT_EXCEEDS_AMOUNT') return null;
      throw error;
    }
  };

  it('every figure is a whole, non-negative number of paise', () => {
    fc.assert(
      fc.property(cart, (input) => {
        const bill = priced(input);
        if (!bill) return;
        const figures = [
          bill.grossPaise,
          bill.discountPaise,
          bill.taxableValuePaise,
          bill.taxPaise,
          bill.subtotalPaise,
          bill.totalPaise,
          ...bill.lines.flatMap((l) => [
            l.grossPaise,
            l.itemDiscountPaise,
            l.billDiscountPaise,
            l.netPaise,
            l.taxableValuePaise,
            l.cgstPaise,
            l.sgstPaise,
            l.igstPaise,
            l.totalPaise,
          ]),
        ];
        for (const figure of figures) {
          expect(Number.isSafeInteger(figure)).toBe(true);
          expect(figure).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('the lines add up to the bill, and the bill to its total', () => {
    fc.assert(
      fc.property(cart, (input) => {
        const bill = priced(input);
        if (!bill) return;
        const sum = (pick: (l: Bill['lines'][number]) => number) =>
          bill.lines.reduce((t, l) => t + pick(l), 0);
        expect(bill.subtotalPaise).toBe(sum((l) => l.totalPaise));
        expect(bill.taxableValuePaise + bill.taxPaise).toBe(bill.subtotalPaise);
        expect(bill.cgstPaise + bill.sgstPaise + bill.igstPaise).toBe(bill.taxPaise);
        expect(bill.totalPaise).toBe(bill.subtotalPaise + bill.roundOffPaise);
        expect(bill.grossPaise - bill.discountPaise).toBe(sum((l) => l.netPaise));
        for (const l of bill.lines) {
          expect(l.taxableValuePaise + l.taxPaise).toBe(l.totalPaise);
          expect(l.cgstPaise + l.sgstPaise + l.igstPaise).toBe(l.taxPaise);
          expect(l.grossPaise - l.itemDiscountPaise - l.billDiscountPaise).toBe(l.netPaise);
        }
      }),
    );
  });

  it('the round-off is under 50 paise either way and the total is a whole rupee', () => {
    fc.assert(
      fc.property(cart, (input) => {
        const bill = priced(input);
        if (!bill) return;
        expect(bill.roundOffPaise).toBeGreaterThanOrEqual(-49);
        expect(bill.roundOffPaise).toBeLessThanOrEqual(50);
        expect(bill.totalPaise % 100).toBe(0);
      }),
    );
  });

  it('a discount never exceeds what it comes off, and the bill discount is shared exactly', () => {
    fc.assert(
      fc.property(cart, (input) => {
        const bill = priced(input);
        if (!bill) return;
        for (const l of bill.lines) {
          expect(l.itemDiscountPaise).toBeLessThanOrEqual(l.grossPaise);
          expect(l.billDiscountPaise).toBeLessThanOrEqual(l.grossPaise - l.itemDiscountPaise);
        }
        const afterItem = bill.grossPaise - bill.itemDiscountPaise;
        expect(bill.billDiscountPaise).toBeLessThanOrEqual(afterItem);
      }),
    );
  });

  it('a bill of supply never carries tax, and another-state sales never carry CGST or SGST', () => {
    fc.assert(
      fc.property(cart, (input) => {
        const bill = priced(input);
        if (!bill) return;
        if (input.documentType === 'BILL_OF_SUPPLY') expect(bill.taxPaise).toBe(0);
        if (input.supply === 'INTER_STATE') expect(bill.cgstPaise + bill.sgstPaise).toBe(0);
        for (const l of bill.lines) expect(l.sgstPaise - l.cgstPaise).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('the HSN summary adds up to the bill', () => {
    fc.assert(
      fc.property(cart, (input) => {
        const bill = priced(input);
        if (!bill) return;
        const sum = (pick: (r: Bill['hsnSummary'][number]) => number) =>
          bill.hsnSummary.reduce((t, r) => t + pick(r), 0);
        expect(sum((r) => r.taxableValuePaise)).toBe(bill.taxableValuePaise);
        expect(sum((r) => r.taxPaise)).toBe(bill.taxPaise);
        expect(sum((r) => r.qty)).toBe(input.lines.reduce((t, l) => t + l.qty, 0));
      }),
    );
  });

  it('sharing a total always adds up exactly and respects each weight', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 20 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (weights, fraction) => {
          const sum = weights.reduce((t, w) => t + w, 0);
          const total = Math.floor(sum * fraction);
          if (sum === 0) return;
          const shares = allocateProRata(BigInt(total), weights.map(BigInt));
          expect(shares.reduce((t, s) => t + s, 0n)).toBe(BigInt(total));
          shares.forEach((share, i) => expect(share <= BigInt(weights[i] ?? 0)).toBe(true));
        },
      ),
    );
  });
});

describe('discount limit (US-POS-02)', () => {
  const lines = (a: Discount | undefined, b: Discount | undefined): LineInput[] => [
    { hsn: null, gstRateBp: 1800, qty: 1, unitPricePaise: 100_000, ...(a ? { discount: a } : {}) },
    { hsn: null, gstRateBp: 1800, qty: 1, unitPricePaise: 100_000, ...(b ? { discount: b } : {}) },
  ];
  const price = (input: LineInput[], billDiscount?: Discount) =>
    calculateBill({
      documentType: 'TAX_INVOICE',
      priceBasis: 'TAX_INCLUSIVE',
      supply: 'INTRA_STATE',
      lines: input,
      ...(billDiscount ? { billDiscount } : {}),
    });

  it('a cashier at 5% may give exactly 5% on the bill', () => {
    const bill = price(lines(undefined, undefined), { kind: 'PERCENT', basisPoints: 500 });
    expect(checkDiscountLimit(bill, 500)).toEqual({
      needsApproval: false,
      billOverLimit: false,
      linesOverLimit: [],
    });
  });

  it('one paisa more than 5% needs approval', () => {
    const bill = price(lines(undefined, undefined), { kind: 'AMOUNT', paise: 10_001 });
    expect(checkDiscountLimit(bill, 500).needsApproval).toBe(true);
    expect(checkDiscountLimit(bill, 500).billOverLimit).toBe(true);
  });

  it('giving one item away free needs approval even when the whole bill is within the limit', () => {
    // 5% of Rs 2,000 is Rs 100; one line of Rs 50 free is within the bill limit but 100% of that line.
    const small: LineInput[] = [
      {
        hsn: null,
        gstRateBp: 1800,
        qty: 1,
        unitPricePaise: 5_000,
        discount: { kind: 'PERCENT', basisPoints: 10_000 },
      },
      { hsn: null, gstRateBp: 1800, qty: 1, unitPricePaise: 195_000 },
    ];
    const check = checkDiscountLimit(price(small), 500);
    expect(check.billOverLimit).toBe(false);
    expect(check.linesOverLimit).toEqual([0]);
    expect(check.needsApproval).toBe(true);
  });

  it('a percentage rounded half a paisa up is not mistaken for going over the limit', () => {
    // 5% of Rs 10.10 (1010 paise) is 50.5 paise, which rounds to 51; the limit allows up to 51 (rounded up).
    const bill = price([
      {
        hsn: null,
        gstRateBp: 0,
        qty: 1,
        unitPricePaise: 1_010,
        discount: { kind: 'PERCENT', basisPoints: 500 },
      },
    ]);
    expect(bill.discountPaise).toBe(51);
    expect(checkDiscountLimit(bill, 500).needsApproval).toBe(false);
  });

  it('a bill-level percentage shared across lines does not trip its own limit through rounding', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 3_000_000 }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 2_000 }),
        (prices, limitBp) => {
          const bill = price(
            prices.map((unitPricePaise) => ({ hsn: null, gstRateBp: 500, qty: 1, unitPricePaise })),
            { kind: 'PERCENT', basisPoints: limitBp },
          );
          expect(checkDiscountLimit(bill, limitBp).needsApproval).toBe(false);
        },
      ),
    );
  });

  it('a limit of zero means any discount needs approval, a limit of 100% means none does', () => {
    const bill = price(lines({ kind: 'AMOUNT', paise: 1 }, undefined));
    expect(checkDiscountLimit(bill, 0).needsApproval).toBe(true);
    expect(checkDiscountLimit(bill, 10_000).needsApproval).toBe(false);
    expect(checkDiscountLimit(price(lines(undefined, undefined)), 0).needsApproval).toBe(false);
  });
});
