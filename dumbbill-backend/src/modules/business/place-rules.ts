import { DomainError } from '../../common/errors/domain-error';
import { TenantTransaction } from '../tenancy/tenant-tx.service';
import { checkGstin } from './domain/gstin';

/** The state and GSTIN a business or branch asks to store. */
export interface PlaceInput {
  stateCode: string;
  gstin?: string | null;
}

/** Plain-English sentence for each way a GSTIN can be wrong. */
const GSTIN_MESSAGES = {
  SHAPE: 'A GSTIN has 15 characters, like 27AAPFU0939F1ZV. Check for a missing or extra character.',
  CHECKSUM:
    'This GSTIN has a typing mistake: its last character does not match the others. Compare it with your GST certificate.',
} as const;

function fieldError(field: string, message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', [{ field, message }]);
}

/**
 * Check the state and GSTIN of a business or a branch before saving them.
 *
 * Rules (GST law and our tax logic depend on them):
 *  1. The state must be a real GST state (the `gst_states` list).
 *  2. A GSTIN must have a valid shape and check character.
 *  3. A GSTIN starts with the state code of the place it is registered in, so it must agree with the chosen state.
 *  4. Every GSTIN of one business shares one PAN (the legal entity's income-tax number), so a branch GSTIN must carry
 *     the same PAN as the business GSTIN when the business has one.
 *
 * @param businessPan PAN of the business GSTIN, or null/undefined when checking the business itself or when it has none.
 * @returns the cleaned GSTIN (or null when none was given).
 * @throws DomainError VALIDATION_FAILED naming the field at fault.
 */
export async function validatePlace(
  tx: TenantTransaction,
  input: PlaceInput,
  businessPan?: string | null,
): Promise<{ gstin: string | null }> {
  const state = await tx.gstState.findUnique({ where: { code: input.stateCode } });
  if (!state) throw fieldError('stateCode', 'Choose a state from the list.');

  if (!input.gstin) return { gstin: null };
  const result = checkGstin(input.gstin);
  if (!result.valid) throw fieldError('gstin', GSTIN_MESSAGES[result.problem]);
  if (result.stateCode !== input.stateCode) {
    throw fieldError(
      'gstin',
      `This GSTIN belongs to state ${result.stateCode}, but the state chosen is ${state.name} (${input.stateCode}).`,
    );
  }
  if (businessPan && result.pan !== businessPan) {
    throw fieldError(
      'gstin',
      'A branch GSTIN must have the same PAN as the business GSTIN (characters 3 to 12). This one belongs to a different PAN.',
    );
  }
  return { gstin: result.gstin };
}

/** The PAN inside a GSTIN (characters 3 to 12), or null when there is no GSTIN. */
export function panOf(gstin: string | null): string | null {
  return gstin ? gstin.slice(2, 12) : null;
}
