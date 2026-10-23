/**
 * Whole-number rounding and sharing, the two things every bill calculation needs.
 *
 * Money is whole PAISE (Rs 1 = 100 paise, ADR 004). Whenever an amount has to be divided (a percentage, a tax, a share of
 * a bill discount) the answer is rounded to whole paise by ONE fixed rule so that the same bill always gives the same
 * numbers on every machine, which is what lets a chartered accountant (CA) check the arithmetic.
 *
 * All multiplication here uses BigInt: a bill of a few lakh rupees times a basis-point rate, or a discount times a line
 * value, can be larger than a normal number holds exactly (about 9 x 10^15).
 */

/**
 * `numerator / denominator` rounded to the nearest whole number, with exact halves rounded UP (away from zero).
 * Both inputs must be non-negative and the denominator above zero. Example: 7 / 2 = 3.5 -> 4; 10 / 4 = 2.5 -> 3.
 *
 * WHY HALF-UP: it is the rule shopkeepers and the GST invoice rules expect ("50 paise rounds up"), and it is easy to
 * explain and to check by hand.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** `numerator / denominator` rounded UP to the next whole number (non-negative inputs, denominator above zero). */
export function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Share `total` between lines in proportion to their `weights`, so the shares add up to `total` EXACTLY.
 *
 * Each line first gets the whole paise of its exact share (rounded down). The paise left over (always fewer than the number
 * of lines) go one each to the lines whose exact share had the biggest fractional part; if two lines tie, the EARLIER
 * line wins. This is the "largest remainder" method. It is fully deterministic: the same cart always splits the same way,
 * whatever order the work is done in.
 *
 * A line with weight 0 never receives anything. If `total` does not exceed the sum of the weights, no line receives more than
 * its own weight (so a discount shared by line value can never take a line below zero).
 *
 * @throws RangeError when `total` is above zero but every weight is zero (there is nothing to share it between).
 */
export function allocateProRata(total: bigint, weights: readonly bigint[]): bigint[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total === 0n) return weights.map(() => 0n);
  if (weightSum === 0n) throw new RangeError('Nothing to share the amount between.');

  const shares = weights.map((weight) => (total * weight) / weightSum);
  const remainders = weights.map((weight) => (total * weight) % weightSum);
  let leftover = Number(total - shares.reduce((sum, share) => sum + share, 0n));

  // Biggest remainder first; on a tie the earlier line.
  const order = weights
    .map((_weight, index) => index)
    .sort((a, b) => {
      const byRemainder =
        remainders[a]! === remainders[b]! ? 0 : remainders[a]! > remainders[b]! ? -1 : 1;
      return byRemainder !== 0 ? byRemainder : a - b;
    });
  for (const index of order) {
    if (leftover === 0) break;
    shares[index] = shares[index]! + 1n;
    leftover -= 1;
  }
  return shares;
}
