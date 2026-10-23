import { divideRoundUp } from './rounding';
import type { BillPricing } from './pricing';

/**
 * Is a priced bill within a person's discount limit, or does it need a manager's approval? (US-POS-02)
 *
 * A cashier may give discounts up to a limit set by the business (basis points of the amount: 500 = 5%). Beyond it the
 * till asks a manager for their PIN. The limit is checked here, on the server's own figures, never on what the client
 * claims.
 *
 * TWO CHECKS, both must pass:
 *  - the WHOLE BILL: item discounts plus the bill discount, against the bill's gross total;
 *  - each LINE'S OWN discount, against that line's gross, so one item cannot be given away free inside an otherwise
 *    small discount. (A line's share of a bill-level discount is not checked on its own: a 5% bill discount is shared
 *    out at about 5% a line, give or take a paisa from rounding, and that must not trip a 5% limit.)
 *
 * The allowed amount is rounded UP to the next paisa. A percentage discount is itself rounded to the nearest paisa, so
 * "exactly 5%" can come out half a paisa above the exact limit; rounding the allowance up forgives that and nothing more.
 */
export interface DiscountLimitCheck {
  /** True when the discount is above what the person may give alone. */
  needsApproval: boolean;
  /** The whole-bill discount is above the limit. */
  billOverLimit: boolean;
  /** Positions (0-based) of lines whose own discount is above the limit. */
  linesOverLimit: number[];
}

/**
 * @param pricing the bill as priced by `calculateBill`
 * @param limitBp the person's limit in basis points (0 = may not discount at all, 10000 = anything)
 */
export function checkDiscountLimit(pricing: BillPricing, limitBp: number): DiscountLimitCheck {
  const allowed = (grossPaise: number): bigint =>
    divideRoundUp(BigInt(grossPaise) * BigInt(limitBp), 10_000n);

  const billOverLimit = BigInt(pricing.discountPaise) > allowed(pricing.grossPaise);
  const linesOverLimit = pricing.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => BigInt(line.itemDiscountPaise) > allowed(line.grossPaise))
    .map(({ index }) => index);

  return {
    needsApproval: billOverLimit || linesOverLimit.length > 0,
    billOverLimit,
    linesOverLimit,
  };
}
