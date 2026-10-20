import fc from 'fast-check';
import {
  allocateExtraCost,
  applyInflow,
  applyOutflow,
  EMPTY_POSITION,
  InsufficientStockError,
  landedLineValue,
  StockPosition,
  wacPaise,
} from '../../src/modules/inventory/domain/costing';

/**
 * The costing engine decides what every unit of stock is worth, and therefore every profit figure. These tests state the
 * rules as PROPERTIES (true for any numbers fast-check can invent) as well as the worked examples from the documents.
 */

/** Realistic ranges: up to 100,000 units, prices up to Rs 1,00,000 a unit. */
const qty = fc.integer({ min: 1, max: 100_000 });
const unitCost = fc.integer({ min: 0, max: 10_000_000 });

describe('weighted average cost: worked examples', () => {
  it('two purchases at different costs keep both layers and average by weight (US-PUR-01)', () => {
    // 2 units at Rs 100, then 3 units at Rs 150: 5 units worth Rs 650, average Rs 130.
    const first = applyInflow(EMPTY_POSITION, 2, 2 * 10_000);
    const second = applyInflow(first.position, 3, 3 * 15_000);
    expect(second.position).toEqual({ qty: 5, valuePaise: 65_000 });
    expect(second.wacAfterPaise).toBe(13_000);
    // The first layer's value is still in the total: nothing was rewritten.
    expect(second.position.valuePaise).toBe(first.position.valuePaise + 45_000);
    expect(first.wacAfterPaise).toBe(10_000);
  });

  it('a sale is costed at the average and leaves the average unchanged', () => {
    const stock = applyInflow(applyInflow(EMPTY_POSITION, 2, 20_000).position, 3, 45_000).position;
    const sale = applyOutflow(stock, 2);
    expect(sale.valueDeltaPaise).toBe(-26_000);
    expect(sale.unitCostPaise).toBe(13_000);
    expect(sale.position).toEqual({ qty: 3, valuePaise: 39_000 });
    expect(sale.wacAfterPaise).toBe(13_000);
  });

  it('taking the last unit takes exactly the value that is left, so nothing is left behind', () => {
    // 3 units worth 100 paise cannot be split into whole paise per unit; the value must still end at exactly zero.
    let position: StockPosition = { qty: 3, valuePaise: 100 };
    const costs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const out = applyOutflow(position, 1);
      costs.push(-out.valueDeltaPaise);
      position = out.position;
    }
    expect(position).toEqual({ qty: 0, valuePaise: 0 });
    expect(costs.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('refuses to sell more than is on hand', () => {
    expect(() => applyOutflow({ qty: 2, valuePaise: 500 }, 3)).toThrow(InsufficientStockError);
    expect(() => applyOutflow(EMPTY_POSITION, 1)).toThrow(InsufficientStockError);
  });

  it('refuses nonsense quantities and values', () => {
    expect(() => applyInflow(EMPTY_POSITION, 0, 10)).toThrow(RangeError);
    expect(() => applyInflow(EMPTY_POSITION, 1.5, 10)).toThrow(RangeError);
    expect(() => applyInflow(EMPTY_POSITION, 1, -1)).toThrow(RangeError);
    expect(() => applyOutflow({ qty: 5, valuePaise: 5 }, -1)).toThrow(RangeError);
  });

  it('can add free stock (value zero) and still has a sensible average', () => {
    const position = applyInflow(applyInflow(EMPTY_POSITION, 2, 20_000).position, 2, 0).position;
    expect(wacPaise(position)).toBe(5_000);
  });
});

describe('landed cost allocation', () => {
  it('spreads freight in proportion to line value (worked example)', () => {
    // Line A is worth Rs 1,000 and line B Rs 3,000; Rs 400 freight splits 100 / 300.
    const shares = allocateExtraCost(
      [
        { qty: 10, unitCostPaise: 10_000 },
        { qty: 30, unitCostPaise: 10_000 },
      ],
      40_000,
    );
    expect(shares).toEqual([10_000, 30_000]);
  });

  it('hands the leftover paise to the lines with the biggest remainders, and the shares always add up', () => {
    // Rs 1.00 over three equal lines: 33 each and one extra paisa to the first.
    expect(
      allocateExtraCost(
        [1, 2, 3].map(() => ({ qty: 1, unitCostPaise: 500 })),
        100,
      ),
    ).toEqual([34, 33, 33]);
  });

  it('splits by quantity when every line is free, and gives a single line everything', () => {
    expect(
      allocateExtraCost(
        [
          { qty: 1, unitCostPaise: 0 },
          { qty: 3, unitCostPaise: 0 },
        ],
        400,
      ),
    ).toEqual([100, 300]);
    expect(allocateExtraCost([{ qty: 7, unitCostPaise: 123 }], 999)).toEqual([999]);
  });

  it('handles no extra cost and no lines', () => {
    expect(allocateExtraCost([{ qty: 1, unitCostPaise: 10 }], 0)).toEqual([0]);
    expect(allocateExtraCost([], 0)).toEqual([]);
    expect(() => allocateExtraCost([], 5)).toThrow(RangeError);
  });

  it('property: the shares always add up to exactly the extra cost, are never negative, and follow the line values', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ qty, unitCostPaise: unitCost }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (lines, extra) => {
          const shares = allocateExtraCost(lines, extra);
          expect(shares).toHaveLength(lines.length);
          expect(shares.reduce((a, b) => a + b, 0)).toBe(extra);
          expect(shares.every((s) => Number.isInteger(s) && s >= 0)).toBe(true);
          // No line is off its exact proportional share by a full paisa or more.
          const total = lines.reduce((sum, l) => sum + BigInt(l.qty) * BigInt(l.unitCostPaise), 0n);
          if (total > 0n) {
            lines.forEach((l, i) => {
              const exact =
                Number(
                  (BigInt(extra) * BigInt(l.qty) * BigInt(l.unitCostPaise) * 1_000_000n) / total,
                ) / 1_000_000;
              expect(Math.abs((shares[i] as number) - exact)).toBeLessThan(1);
            });
          }
        },
      ),
    );
  });

  it('property: the landed values of all lines add up to the bill total plus the extra cost', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ qty, unitCostPaise: unitCost }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        (lines, extra) => {
          const shares = allocateExtraCost(lines, extra);
          const landed = lines.reduce(
            (sum, line, i) => sum + landedLineValue(line, shares[i] as number),
            0,
          );
          const plain = lines.reduce((sum, line) => sum + line.qty * line.unitCostPaise, 0);
          expect(landed).toBe(plain + extra);
        },
      ),
    );
  });
});

describe('properties of the costing rules', () => {
  const position = fc.record({
    qty: fc.integer({ min: 1, max: 100_000 }),
    valuePaise: fc.integer({ min: 0, max: 1_000_000_000_000 }),
  });

  it('a purchase gives the weighted mean (within one paisa of rounding), and keeps every layer of value', () => {
    fc.assert(
      fc.property(position, qty, unitCost, (before, inQty, cost) => {
        const bought = applyInflow(before, inQty, inQty * cost);
        expect(bought.position.valuePaise).toBe(before.valuePaise + inQty * cost);
        expect(bought.position.qty).toBe(before.qty + inQty);
        const exactMean = (before.valuePaise + inQty * cost) / (before.qty + inQty);
        expect(Math.abs(bought.wacAfterPaise - exactMean)).toBeLessThanOrEqual(0.5);
      }),
    );
  });

  it('a sale is costed at the average: its cost per unit matches the average, and the average barely moves', () => {
    fc.assert(
      fc.property(position, fc.integer({ min: 1, max: 100_000 }), (before, wanted) => {
        const out = Math.min(wanted, before.qty);
        const sale = applyOutflow(before, out);
        expect(-sale.valueDeltaPaise).toBeLessThanOrEqual(before.valuePaise);
        if (out < before.qty) {
          // The units left are worth within a paisa per unit of the average they were costed at.
          expect(Math.abs(sale.wacAfterPaise - wacPaise(before))).toBeLessThanOrEqual(1);
          // What left is worth its proportional share to the nearest paisa.
          expect(
            Math.abs(-sale.valueDeltaPaise - (before.valuePaise * out) / before.qty),
          ).toBeLessThanOrEqual(0.5);
        } else {
          expect(sale.position).toEqual({ qty: 0, valuePaise: 0 });
        }
      }),
    );
  });

  it('a transfer moves value without creating or losing any (the cost travels with the goods)', () => {
    fc.assert(
      fc.property(position, position, fc.integer({ min: 1, max: 100_000 }), (from, to, wanted) => {
        const out = applyOutflow(from, Math.min(wanted, from.qty));
        const arrival = applyInflow(to, -out.qtyDelta, -out.valueDeltaPaise);
        expect(out.position.qty + arrival.position.qty).toBe(from.qty + to.qty);
        expect(out.position.valuePaise + arrival.position.valuePaise).toBe(
          from.valuePaise + to.valuePaise,
        );
      }),
    );
  });

  it('a return at the original cost restores exactly the value that the sale removed', () => {
    fc.assert(
      fc.property(position, fc.integer({ min: 1, max: 100_000 }), (before, wanted) => {
        const out = Math.min(wanted, before.qty);
        const sale = applyOutflow(before, out);
        const back = applyInflow(sale.position, out, -sale.valueDeltaPaise);
        expect(back.position).toEqual(before);
      }),
    );
  });

  it('any run of purchases and sales: stock is never negative, value is never negative, zero stock has zero value, and the ledger adds up to the position (US-STK-01)', () => {
    const step = fc.oneof(
      fc.record({
        kind: fc.constant('in' as const),
        qty: fc.integer({ min: 1, max: 1_000 }),
        cost: fc.integer({ min: 0, max: 1_000_000 }),
      }),
      fc.record({
        kind: fc.constant('out' as const),
        qty: fc.integer({ min: 1, max: 1_500 }),
        cost: fc.constant(0),
      }),
    );
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 60 }), (steps) => {
        let current: StockPosition = EMPTY_POSITION;
        let ledgerQty = 0;
        let ledgerValue = 0;
        for (const s of steps) {
          if (s.kind === 'in') {
            const m = applyInflow(current, s.qty, s.qty * s.cost);
            ledgerQty += m.qtyDelta;
            ledgerValue += m.valueDeltaPaise;
            current = m.position;
          } else if (s.qty <= current.qty) {
            const m = applyOutflow(current, s.qty);
            ledgerQty += m.qtyDelta;
            ledgerValue += m.valueDeltaPaise;
            current = m.position;
          } else {
            expect(() => applyOutflow(current, s.qty)).toThrow(InsufficientStockError);
          }
          expect(current.qty).toBeGreaterThanOrEqual(0);
          expect(current.valuePaise).toBeGreaterThanOrEqual(0);
          if (current.qty === 0) expect(current.valuePaise).toBe(0);
          // The invariant the whole design rests on: the position IS the sum of its movements.
          expect(ledgerQty).toBe(current.qty);
          expect(ledgerValue).toBe(current.valuePaise);
        }
      }),
    );
  });

  it('values larger than a normal number can multiply exactly stay exact (a very large stock)', () => {
    // Rs 5 crore of stock and a large quantity: value x qty is far above 2^53, so ordinary arithmetic would be wrong.
    const big: StockPosition = { qty: 900_000, valuePaise: 5_000_000_000_000_001 };
    const out = applyOutflow(big, 450_000);
    expect(out.valueDeltaPaise).toBe(-2_500_000_000_000_001);
    expect(out.position.valuePaise + 2_500_000_000_000_001).toBe(5_000_000_000_000_001);
  });
});
