import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../api/errors';

/**
 * Shows the server's field-by-field validation errors inside a react-hook-form form.
 *
 * The server answers a bad submission with code VALIDATION_FAILED and a list `errors[]` of
 * `{ field, message }` (see docs/api/error-codes.md). This puts each message next to its field.
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
): boolean {
  if (
    !(error instanceof ApiError) ||
    error.code !== 'VALIDATION_FAILED' ||
    error.fieldErrors.length === 0
  ) {
    return false;
  }
  for (const { field, message } of error.fieldErrors) {
    // `type: 'server'` marks the message as coming from the server, so it can be cleared on the next edit.
    setError(field as Path<TFieldValues>, { type: 'server', message });
  }
  return true;
}
