/**
 * Stock costing: the weighted average cost (WAC) engine, as pure functions (no database, no clock).
 *
 * VOCABULARY
 *  - A "position" is what one branch holds of one product: how many units (`qty`) and what the whole stock is worth
 *    (`valuePaise`). Paise are whole hundredths of a rupee (Rs 1 = 100 paise); money is never a decimal number.
 *  - The WEIGHTED AVERAGE COST of a position is its value divided by its quantity: if you hold 2 units that cost Rs 100
 *    and 3 units that cost Rs 150, you hold 5 units worth Rs 650 and the average cost is Rs 130 each.
 *  - LANDED COST means what goods really cost once the extra costs of getting them (freight, loading) are added to the
 *    supplier's price, spread over the lines of the bill.
 *
 * WHY THE VALUE IS KEPT AS A TOTAL, NOT AS A PER-UNIT COST
 * A per-unit cost in whole paise has to be rounded, and rounding on every sale lets a small error build up until the books
 * no longer match reality. Instead the position remembers the exact TOTAL value. Selling or sending out `n` of `q` units
 * removes `round(value x n / q)` paise, so the units left always carry exactly the value that is left, and when the last
 * unit goes the value reaches exactly zero (no stray paise). The per-unit cost shown on screens is just value / qty,
 * rounded for display.
 *
 * RULES (architecture section 6)
 *  - Purchase: the new average is (old value + landed value in) / (old qty + qty in).
 *  - Sale: costed at the current average; the average does not change.
 *  - Sale return: goes back at the cost it was sold at.
 *  - Transfer: leaves at the sending branch's average, arrives at that same value.
 *
 * All arithmetic that multiplies money by a quantity uses BigInt internally, because a shop's stock value in paise can be
 * large enough that value x quantity exceeds what an ordinary number holds exactly.
 */

/** What one branch holds of one product. */
export interface StockPosition {
  /** Units on hand. Never negative. */
  qty: number;
  /** What the units on hand are worth, in paise. Never negative; zero whenever `qty` is zero. */
  valuePaise: number;
}

/** Nothing in stock. The starting point of every product at every branch. */
export const EMPTY_POSITION: StockPosition = { qty: 0, valuePaise: 0 };

/** Thrown when more units are asked for than are on hand. */
export class InsufficientStockError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(`Only ${available} in stock, ${requested} requested.`);
    this.name = 'InsufficientStockError';
  }
}

/** The result of moving stock: the new position, and what this one movement was worth. */
export interface Movement {
  position: StockPosition;
  /** Units added (positive) or removed (negative). */
  qtyDelta: number;
  /** Value added (positive) or removed (negative), in paise. */
  valueDeltaPaise: number;
  /** What one unit of THIS movement cost, rounded, in paise. For display. */
  unitCostPaise: number;
  /** The average cost per unit after the movement, rounded, in paise. */
  wacAfterPaise: number;
}

/** Whole-number division that rounds halves up, for non-negative numbers (BigInt, so large values stay exact). */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

function assertWholeNonNegative(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number of at least 0, received ${value}.`);
  }
}

/** The average cost of one unit of a position, rounded to a whole paisa. Zero when nothing is in stock. */
export function wacPaise(position: StockPosition): number {
  if (position.qty === 0) return 0;
  return Number(divideRoundHalfUp(BigInt(position.valuePaise), BigInt(position.qty)));
}

/** What `qty` units of value `valuePaise` cost each, rounded. Zero for zero units. */
export function unitCostOf(valuePaise: number, qty: number): number {
  return wacPaise({ qty, valuePaise });
}

/**
 * Add units that arrive WITH a value: a purchase (landed value), goods arriving by transfer (the value they left with),
 * a cancelled transfer returning, a sale return (the cost they were sold at), or a recount that found extra stock.
 *
 * @param valuePaise what the arriving units are worth in total, in paise (zero is allowed: free stock).
 */
export function applyInflow(position: StockPosition, qty: number, valuePaise: number): Movement {
  if (!Number.isSafeInteger(qty) || qty <= 0)
    throw new RangeError(`qty must be a whole number above 0, received ${qty}.`);
  assertWholeNonNegative(valuePaise, 'valuePaise');
  const next: StockPosition = {
    qty: position.qty + qty,
    valuePaise: position.valuePaise + valuePaise,
  };
  return {
    position: next,
    qtyDelta: qty,
    valueDeltaPaise: valuePaise,
    unitCostPaise: unitCostOf(valuePaise, qty),
    wacAfterPaise: wacPaise(next),
  };
}

/**
 * Remove units at the current weighted average: a sale, a transfer out, a supplier return, a write-off, a recount that
 * found less stock. The units leave carrying their share of the value, so the average cost of what remains is unchanged
 * (apart from a possible one-paisa rounding step).
 *
 * @throws InsufficientStockError when fewer units are on hand than requested (stock never goes below zero here).
 */
export function applyOutflow(position: StockPosition, qty: number): Movement {
  if (!Number.isSafeInteger(qty) || qty <= 0)
    throw new RangeError(`qty must be a whole number above 0, received ${qty}.`);
  if (qty > position.qty) throw new InsufficientStockError(position.qty, qty);
  // Taking everything takes exactly the value that is left; otherwise the proportional share, rounded.
  const removed =
    qty === position.qty
      ? position.valuePaise
      : Number(divideRoundHalfUp(BigInt(position.valuePaise) * BigInt(qty), BigInt(position.qty)));
  const next: StockPosition = {
    qty: position.qty - qty,
    valuePaise: position.valuePaise - removed,
  };
  return {
    position: next,
    qtyDelta: -qty,
    valueDeltaPaise: removed === 0 ? 0 : -removed,
    unitCostPaise: unitCostOf(removed, qty),
    wacAfterPaise: wacPaise(next),
  };
}

/** One line of a purchase bill, for spreading the extra costs. */
export interface CostLine {
  qty: number;
  /** What the supplier charges per unit, in paise. */
  unitCostPaise: number;
}

/**
 * Spread a bill's extra costs (freight and so on) over its lines in proportion to each line's value (qty x unit cost).
 *
 * The shares are whole paise and ALWAYS add up to exactly `extraCostPaise`: each line first gets the whole paise of its
 * exact share, and the few paise left over go one each to the lines with the biggest fractional remainders (the "largest
 * remainder" method; ties go to the earlier line). A bill whose lines are all free is split by quantity instead.
 *
 * @returns each line's share, in the same order as `lines`.
 */
export function allocateExtraCost(lines: readonly CostLine[], extraCostPaise: number): number[] {
  assertWholeNonNegative(extraCostPaise, 'extraCostPaise');
  if (lines.length === 0) {
    if (extraCostPaise > 0)
      throw new RangeError('There are no lines to spread the extra cost over.');
    return [];
  }
  const weights = lines.map((line) => BigInt(line.qty) * BigInt(line.unitCostPaise));
  let totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  const basis = totalWeight > 0n ? weights : lines.map((line) => BigInt(line.qty));
  if (totalWeight === 0n) totalWeight = basis.reduce((sum, weight) => sum + weight, 0n);

  const extra = BigInt(extraCostPaise);
  const floors = basis.map((weight) => (extra * weight) / totalWeight);
  const remainders = basis.map((weight, index) => ({
    index,
    remainder: (extra * weight) % totalWeight,
  }));
  let leftover = extra - floors.reduce((sum, share) => sum + share, 0n);
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (leftover === 0n) break;
    floors[index] = (floors[index] as bigint) + 1n;
    leftover -= 1n;
  }
  return floors.map(Number);
}

/** The landed value of one purchase line: qty x unit cost plus its share of the extra costs, in paise. */
export function landedLineValue(line: CostLine, allocatedPaise: number): number {
  return Number(BigInt(line.qty) * BigInt(line.unitCostPaise) + BigInt(allocatedPaise));
}
