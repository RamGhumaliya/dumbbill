/**
 * GSTIN rules (pure functions, no database).
 *
 * A GSTIN is the 15-character GST registration number of a business, for example `27AAPFU0939F1ZV`:
 *
 *   27          the GST state code (27 = Maharashtra)
 *   AAPFU0939F  the PAN, the income-tax number of the legal entity
 *   1           the entity number: how many GST registrations that PAN has in this state (1-9, then A-Z)
 *   Z           always the letter Z
 *   V           a check character calculated from the other 14 (catches typing mistakes)
 *
 * Why we check it: a wrong GSTIN on an invoice makes the buyer's input tax credit fail. Catching a typo at sign-up is
 * far cheaper than a customer's tax notice. We validate the SHAPE and the CHECK CHARACTER here; whether the two-digit
 * state code is a real GST state is checked against the `gst_states` table by the service (one list, owned by the
 * seed). We cannot confirm offline that the GST portal knows the number.
 */

/** Shape only: digits and letters in the right places. The same pattern is enforced by a CHECK in the database. */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The 36 symbols a GSTIN may use, in value order: 0-9 are 0-9, A-Z are 10-35. */
const CODEPOINT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Why a GSTIN was refused. The API turns each reason into a plain sentence. */
export type GstinProblem = 'SHAPE' | 'CHECKSUM';

/** Result of looking at a GSTIN. */
export type GstinCheck =
  | { valid: true; gstin: string; stateCode: string; pan: string }
  | { valid: false; problem: GstinProblem };

/** Remove spaces and upper-case what a person typed or pasted, so `27aapfu0939f1zv ` is accepted. */
export function normaliseGstin(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * The check character for the first 14 characters.
 *
 * Official method (mod-36 weighted sum): each character's value is multiplied by 1 or 2 alternately, each product is
 * split into base-36 "digits" that are added up, and the check value is what is needed to reach the next multiple
 * of 36.
 */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = CODEPOINT_CHARS.indexOf(first14[index] ?? '');
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CODEPOINT_CHARS[(36 - (sum % 36)) % 36] as string;
}

/**
 * Check a GSTIN. Returns the cleaned number with its state code and PAN when valid, or the first problem found.
 */
export function checkGstin(input: string): GstinCheck {
  const gstin = normaliseGstin(input);
  if (!GSTIN_SHAPE.test(gstin)) return { valid: false, problem: 'SHAPE' };
  const stateCode = gstin.slice(0, 2);
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14])
    return { valid: false, problem: 'CHECKSUM' };
  return { valid: true, gstin, stateCode, pan: gstin.slice(2, 12) };
}
