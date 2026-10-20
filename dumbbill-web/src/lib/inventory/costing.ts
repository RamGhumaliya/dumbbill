/**
 * The purchase entry screen's LIVE PREVIEW of landed costs and the new average cost, while the person types.
 *
 * THE SERVER IS THE TRUTH. These functions repeat the server's rules (`dumbbill-backend/src/modules/inventory/domain/
 * costing.ts`) only so the screen can show the answer before the purchase is saved. After saving, the screen shows what
 * the server calculated. Both sides share the same worked examples in their tests, so they cannot drift apart unnoticed.
 *
 * Money is whole PAISE (an integer; Rs 1 = 100 paise). Multiplications use BigInt, so large amounts stay exact.
 *
 *  - LANDED COST: what goods really cost once the extra costs of getting them (freight, loading) are added, spread over
 *    the lines of the bill in proportion to each line's value.
 *  - WEIGHTED AVERAGE COST (WAC): the value of all the stock divided by the number of units. New stock adds its landed
 *    value, so the average becomes the weighted mean of old and new.
 */

/** One line of a bill, as typed. */
export interface PreviewLine {
  qty: number;
  unitCostPaise: number;
}

/**
 * Spread `extraCostPaise` over the lines in proportion to their value (qty x unit cost), in whole paise that always add up
 * to exactly the extra cost: each line gets the whole paise of its exact share, and the paise left over go one each to the
 * biggest fractional remainders (ties to the earlier line). A bill of all-free lines is split by quantity.
 */
export function allocateExtraCost(lines: readonly PreviewLine[], extraCostPaise: number): number[] {
  if (lines.length === 0) return [];
  const weights = lines.map((line) => BigInt(line.qty) * BigInt(line.unitCostPaise));
  let total = weights.reduce((sum, weight) => sum + weight, 0n);
  const basis = total > 0n ? weights : lines.map((line) => BigInt(line.qty));
  if (total === 0n) total = basis.reduce((sum, weight) => sum + weight, 0n);
  if (total === 0n) return lines.map(() => 0);

  const extra = BigInt(extraCostPaise);
  const shares = basis.map((weight) => (extra * weight) / total);
  const order = basis
    .map((weight, index) => ({ index, remainder: (extra * weight) % total }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  let leftover = extra - shares.reduce((sum, share) => sum + share, 0n);
  for (const { index } of order) {
    if (leftover === 0n) break;
    shares[index] = (shares[index] as bigint) + 1n;
    leftover -= 1n;
  }
  return shares.map(Number);
}

/** What a line really costs once its share of the extra costs is added: qty x unit cost + share, in paise. */
export function landedLineValue(line: PreviewLine, sharePaise: number): number {
  return Number(BigInt(line.qty) * BigInt(line.unitCostPaise) + BigInt(sharePaise));
}

/** The average cost of a position, rounded half-up to a whole paisa. Zero when there are no units. */
export function averageCost(qty: number, valuePaise: number): number {
  if (qty <= 0) return 0;
  return Number((2n * BigInt(valuePaise) + BigInt(qty)) / (2n * BigInt(qty)));
}

/**
 * What the average cost WOULD become if this much landed value arrived on top of what is held now.
 * @returns the new average per unit, in paise.
 */
export function previewAverageCost(
  held: { qty: number; valuePaise: number },
  arriving: { qty: number; valuePaise: number },
): number {
  return averageCost(held.qty + arriving.qty, held.valuePaise + arriving.valuePaise);
}
