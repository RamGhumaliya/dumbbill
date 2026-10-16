import { expect, test } from '@playwright/test';
import { formatPaise } from '@/lib/format/money';

/** Money is shown with Indian digit grouping (lakhs and crores) and is always built from whole paise. */
test.describe('formatPaise', () => {
  test('formats with the rupee sign, two decimals and Indian grouping', () => {
    expect(formatPaise(489_900)).toBe('₹4,899.00');
    expect(formatPaise(12_450_000)).toBe('₹1,24,500.00');
    expect(formatPaise(999_999_900)).toBe('₹99,99,999.00');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(0)).toBe('₹0.00');
  });

  test('shows negative amounts (refunds, discounts) with a minus sign', () => {
    expect(formatPaise(-35_230)).toBe('-₹352.30');
  });

  test('can drop ".00" for whole-rupee totals, but never hides real paise', () => {
    expect(formatPaise(669_400, { trimZeroPaise: true })).toBe('₹6,694');
    expect(formatPaise(669_430, { trimZeroPaise: true })).toBe('₹6,694.30');
  });

  test('rejects amounts that are not whole paise (a sign of a bug upstream)', () => {
    expect(() => formatPaise(10.5)).toThrow(/whole number of paise/);
    expect(() => formatPaise(Number.NaN)).toThrow();
    expect(() => formatPaise(Infinity)).toThrow();
  });
});
