import { expect, test } from '@playwright/test';
import { formatPaise, paiseToRupeeText, parseRupeesToPaise } from '@/lib/format/money';

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

/** What a person types in a price box becomes exact paise; nothing is ever computed with decimal numbers. */
test.describe('parseRupeesToPaise', () => {
  test('reads typed amounts exactly, including ones that floating point gets wrong', () => {
    expect(parseRupeesToPaise('1499')).toBe(149_900);
    expect(parseRupeesToPaise('1,24,500.50')).toBe(12_450_050);
    expect(parseRupeesToPaise('₹ 299')).toBe(29_900);
    expect(parseRupeesToPaise('19.99')).toBe(1_999);
    expect(parseRupeesToPaise('0.5')).toBe(50);
  });

  test('refuses anything that is not an amount', () => {
    for (const text of ['', 'abc', '-5', '1.234', '1e5', '10000001'])
      expect(parseRupeesToPaise(text)).toBeNull();
  });

  test('round-trips with the text shown in an edit box', () => {
    for (const paise of [0, 5, 100, 29_900, 299_950, 12_450_050])
      expect(parseRupeesToPaise(paiseToRupeeText(paise))).toBe(paise);
    expect(paiseToRupeeText(299_950)).toBe('2999.50');
    expect(paiseToRupeeText(300_000)).toBe('3000');
  });
});
