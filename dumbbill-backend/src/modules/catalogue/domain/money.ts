/**
 * Turning rupee text into paise, without ever using decimal arithmetic.
 *
 * Money is whole PAISE everywhere in the system (Rs 1 = 100 paise, ADR 004), because decimal numbers cannot represent
 * 0.1 exactly and a bill must never be a paisa off. People and spreadsheets write rupees ("1499.50"), so the CSV
 * import converts at the edge, by reading the digits as TEXT: no multiplication, no rounding, no floating point.
 */

/** Largest amount accepted: Rs 1 crore. A guard against a typo (an extra zero) becoming a real price. */
export const MAX_PAISE = 10_000_000_00;

/**
 * Read "1499", "1499.5", "1,499.50" or "₹1499.50" as paise (149950).
 *
 * Accepts at most two decimal places and ignores thousands commas, spaces and a leading rupee sign.
 *
 * @returns the amount in paise, or `null` when the text is not a valid amount (negative, letters, 3 decimals, too big).
 */
export function rupeesToPaise(text: string): number | null {
  const cleaned = text.replace(/[₹\s,]/g, '').replace(/^Rs\.?/i, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return paise <= MAX_PAISE ? paise : null;
}
