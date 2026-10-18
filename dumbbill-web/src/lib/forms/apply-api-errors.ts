import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../api/errors';

/**
 * Shows the server's field-by-field validation errors inside a react-hook-form form.
 *
 * The server answers a bad submission with code VALIDATION_FAILED (or WEAK_PASSWORD for a refused password)
 * and a list `errors[]` of `{ field, message }` (see docs/api/error-codes.md). This puts each message next to its field.
 *
 * Returns true if it handled the error (the form now shows the messages), false if the error was
 * something else and the caller should show a general message instead (for example with the requestId).
 *
 *   try { await submit(values); }
 *   catch (error) { if (!applyApiErrors(error, form.setError)) showGeneralError(error); }
 *
 * The browser checks the same rules first with zod, so this only fires for rules the browser cannot
 * know, such as "this email is already registered".
 */
export function applyApiErrors<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
  /**
   * When the server names a field differently from the form (the API says `password` for any new password,
   * the "choose a new password" form calls it `newPassword`), map server name to form name here.
   */
  renames: Record<string, string> = {},
): boolean {
  if (
    !(error instanceof ApiError) ||
    !FIELD_ERROR_CODES.has(error.code) ||
    error.fieldErrors.length === 0
  ) {
    return false;
  }
  for (const { field, message } of error.fieldErrors) {
    // `type: 'server'` marks the message as coming from the server, so it can be cleared on the next edit.
    setError((renames[field] ?? field) as Path<TFieldValues>, { type: 'server', message });
  }
  return true;
}

/** Error codes whose `errors[]` list belongs next to form fields: invalid input, and a password the rules refuse. */
const FIELD_ERROR_CODES: ReadonlySet<string> = new Set(['VALIDATION_FAILED', 'WEAK_PASSWORD']);
