import { expect, test } from '@playwright/test';
import { ApiError } from '@/lib/api/errors';
import { applyApiErrors } from '@/lib/forms/apply-api-errors';

type Call = [string, { type: string; message?: string }];

/** Server validation errors must land next to the right form fields; anything else must be left to the caller. */
test.describe('applyApiErrors', () => {
  const validation = new ApiError(
    400,
    'VALIDATION_FAILED',
    'Some fields are invalid',
    'REQ1',
    'x',
    [
      { field: 'email', message: 'must be an email' },
      { field: 'items.0.quantity', message: 'must not be less than 1' },
    ],
  );

  test('sets one error per field, marked as coming from the server, and reports it handled', () => {
    const calls: Call[] = [];
    const handled = applyApiErrors(validation, ((
      name: string,
      error: { type: string; message?: string },
    ) => calls.push([name, error])) as never);
    expect(handled).toBe(true);
    expect(calls).toEqual([
      ['email', { type: 'server', message: 'must be an email' }],
      ['items.0.quantity', { type: 'server', message: 'must not be less than 1' }],
    ]);
  });

  test('ignores other errors so the caller can show a general message with the reference', () => {
    const calls: Call[] = [];
    const setError = ((name: string, error: { type: string }) =>
      calls.push([name, error])) as never;
    expect(applyApiErrors(new ApiError(500, 'INTERNAL_ERROR', 'Oops', 'REQ2'), setError)).toBe(
      false,
    );
    expect(
      applyApiErrors(new ApiError(400, 'VALIDATION_FAILED', 'Invalid', 'REQ3'), setError),
    ).toBe(false); // no field list
    expect(applyApiErrors(new Error('plain'), setError)).toBe(false);
    expect(applyApiErrors('text', setError)).toBe(false);
    expect(calls).toEqual([]);
  });
});
