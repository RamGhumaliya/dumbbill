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

const percent = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Format basis points (1 bp = 0.01%) as a percentage with one decimal, for example 2550 -> "25.5%". */
export function formatBasisPoints(basisPoints: number): string {
  return percent.format(basisPoints / 10_000);
}

/** Largest amount a price box accepts: Rs 1 crore, in paise. The API enforces the same guard. */
export const MAX_PRICE_PAISE = 10_000_000_00;

/**
 * Read what a person typed in a price box ("1499", "1,499.50", "₹299") as whole paise, without decimal arithmetic.
 * The digits are read as TEXT (19.99 would be 1998.9999999999998 as a float), so the result is always exact.
 *
 * @returns the amount in paise, or `null` when it is not an amount (empty, negative, letters, more than two decimals,
 *   above Rs 1 crore).
 */
export function parseRupeesToPaise(text: string): number | null {
  const cleaned = text.replace(/[₹\s,]/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return paise <= MAX_PRICE_PAISE ? paise : null;
}

/** An amount in paise as the plain text a price box shows for editing: 299900 -> "2999", 299950 -> "2999.50". No symbol, no commas. */
export function paiseToRupeeText(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error(`Money must be a whole, non-negative number of paise, received ${paise}.`);
  }
  const rupeesPart = Math.floor(paise / 100);
  const paisePart = paise % 100;
  return paisePart === 0
    ? String(rupeesPart)
    : `${rupeesPart}.${String(paisePart).padStart(2, '0')}`;
}
