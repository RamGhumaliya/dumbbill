/**
 * Showing money.
 *
 * Money is ALWAYS whole PAISE (an integer; Rs 1 = 100 paise) everywhere in the code, exactly as the API
 * sends it. It is turned into text only here, at the very edge, so rounding errors from decimal numbers
 * (0.1 + 0.2) can never reach a bill. Never do arithmetic on rupee decimals.
 *
 * Indian digit grouping is used: 1,24,500.00 (not 124,500.00).
 */
const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export interface FormatPaiseOptions {
  /** Drop the ".00" when the amount is a whole number of rupees (for big totals). Default: false. */
  trimZeroPaise?: boolean;
}

/**
 * Format an amount in paise as rupees, for example 489900 -> "₹4,899.00".
 * Throws if the value is not a whole number, because a fractional paise means a bug upstream.
 */
export function formatPaise(paise: number, options: FormatPaiseOptions = {}): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`Money must be a whole number of paise, received ${paise}.`);
  }
  if (options.trimZeroPaise && paise % 100 === 0) {
    return wholeRupees.format(paise / 100);
  }
  return rupees.format(paise / 100);
}
