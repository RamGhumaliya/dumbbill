import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateBill, PricingError, type BillInput } from '@/lib/pos/pricing';

/**
 * The till's preview must give the same bill as the server. Both calculators are held to the same golden file, whose
 * answers were worked out separately (docs/04-qa/gst-golden/generate_golden.py) and are reviewed by a chartered
 * accountant. The backend has a test that fails when this copy of the file differs from the original.
 */
const golden: Array<{ name: string; input: BillInput; expected: unknown }> = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/gst-golden/cases.json'), 'utf8'),
);

test.describe('golden file (US-POS-04)', () => {
  test('has the carts the CA reviews', () => {
    expect(golden.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of golden) {
    test(c.name, () => {
      expect(calculateBill(c.input)).toEqual(c.expected);
    });
  }
});

test.describe('carts the preview refuses', () => {
  const line = { hsn: null, gstRateBp: 500, qty: 1, unitPricePaise: 10_000 };
  const cart = (
    lines: BillInput['lines'],
    billDiscount?: BillInput['billDiscount'],
  ): BillInput => ({
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

  test('same refusals as the server', () => {
    expect(codeOf(cart([]))).toBe('EMPTY_CART');
    expect(codeOf(cart([{ ...line, qty: 0 }]))).toBe('INVALID_QUANTITY');
    expect(codeOf(cart([{ ...line, unitPricePaise: -1 }]))).toBe('INVALID_AMOUNT');
    expect(codeOf(cart([{ ...line, gstRateBp: 10_001 }]))).toBe('INVALID_RATE');
    expect(codeOf(cart([line], { kind: 'AMOUNT', paise: 10_001 }))).toBe('DISCOUNT_EXCEEDS_AMOUNT');
    expect(codeOf(cart([line], { kind: 'PERCENT', basisPoints: 10_001 }))).toBe('INVALID_DISCOUNT');
    expect(codeOf(cart(Array.from({ length: 201 }, () => line)))).toBe('TOO_MANY_LINES');
  });

  test('a bill of any size is exact (no float drift on big carts)', () => {
    const big = calculateBill(
      cart([{ hsn: '21069099', gstRateBp: 1800, qty: 99_999, unitPricePaise: 99_999 }]),
    );
    expect(big.taxableValuePaise + big.taxPaise).toBe(big.subtotalPaise);
    expect(big.totalPaise % 100).toBe(0);
  });
});
