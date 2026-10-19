/**
 * The GST rates a product may carry, in basis points (100 basis points = 1%, so 1800 = 18%).
 *
 * WHERE THIS COMES FROM: the slabs in force after the September 2025 GST reform are 0%, 5%, 18% and 40%, plus the
 * special 3% (precious metals) and 0.25%. A shop owner never types a rate; they choose from this list, which stops
 * a typo such as 1.8% or 180% from reaching an invoice.
 *
 * OWNER: the retailer's CA must confirm these before the first real invoice (docs/07-open-questions.md). When the law
 * changes, change THIS list only: the API, the CSV import and the screens all read it.
 */
export const ALLOWED_GST_RATES_BP: readonly number[] = [0, 25, 300, 500, 1800, 4000];

/** Is this one of the rates above? */
export function isAllowedGstRate(rateBp: number): boolean {
  return ALLOWED_GST_RATES_BP.includes(rateBp);
}

/**
 * Read a percentage typed in a spreadsheet ("18", "18%", "5.0", "0.25") as basis points.
 * @returns the basis points, or `null` when it is not a number with at most two decimals.
 */
export function percentToBasisPoints(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.replace(/[%\s]/g, ''));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}
