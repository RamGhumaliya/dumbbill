import { expect, test } from '@playwright/test';
import {
  allocateExtraCost,
  averageCost,
  landedLineValue,
  previewAverageCost,
} from '@/lib/inventory/costing';

/**
 * The purchase screen's live preview must agree with the server's costing (the backend has the same worked examples in
 * test/unit/costing.spec.ts). If one side changes, one of these examples fails.
 */
test.describe('landed cost preview', () => {
  test('spreads freight in proportion to line value (the shared worked example)', () => {
    // Line A worth Rs 1,000, line B worth Rs 3,000; Rs 400 freight splits Rs 100 / Rs 300.
    const lines = [
      { qty: 10, unitCostPaise: 10_000 },
      { qty: 30, unitCostPaise: 10_000 },
    ];
    expect(allocateExtraCost(lines, 40_000)).toEqual([10_000, 30_000]);
  });

  test('hands leftover paise to the biggest remainders so the shares always add up exactly', () => {
    const lines = [1, 2, 3].map(() => ({ qty: 1, unitCostPaise: 500 }));
    expect(allocateExtraCost(lines, 100)).toEqual([34, 33, 33]);
    for (const extra of [0, 1, 7, 99, 12_345]) {
      const shares = allocateExtraCost(lines, extra);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(extra);
    }
  });

  test('splits by quantity when every line is free, and copes with no lines', () => {
    expect(
      allocateExtraCost(
        [
          { qty: 1, unitCostPaise: 0 },
          { qty: 3, unitCostPaise: 0 },
        ],
        400,
      ),
    ).toEqual([100, 300]);
    expect(allocateExtraCost([], 500)).toEqual([]);
  });

  test('the landed value of a line is qty x unit cost plus its share', () => {
    expect(landedLineValue({ qty: 24, unitCostPaise: 249_900 }, 1_500)).toBe(24 * 249_900 + 1_500);
  });
});

test.describe('average cost preview', () => {
  test('two purchases at different costs average by weight (the shared worked example)', () => {
    // 2 units at Rs 100 then 3 at Rs 150: 5 units worth Rs 650, average Rs 130.
    const afterFirst = { qty: 2, valuePaise: 20_000 };
    expect(previewAverageCost(afterFirst, { qty: 3, valuePaise: 45_000 })).toBe(13_000);
  });

  test('a first purchase gives its own cost, and an empty position has no average', () => {
    expect(previewAverageCost({ qty: 0, valuePaise: 0 }, { qty: 4, valuePaise: 10_001 })).toBe(
      2_500,
    );
    expect(averageCost(0, 0)).toBe(0);
  });

  test('rounds halves up to a whole paisa, and stays exact for very large stock', () => {
    expect(averageCost(2, 5)).toBe(3);
    expect(averageCost(900_000, 5_000_000_000_000_001)).toBe(5_555_555_556);
  });
});
