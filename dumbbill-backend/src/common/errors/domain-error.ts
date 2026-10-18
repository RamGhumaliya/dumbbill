import { ErrorCode } from './error-codes';

/** One problem with one input field, shown next to that field in the apps. */
export interface FieldError {
  /** Dotted path of the field, for example `discount.value`. */
  field: string;
  /** What is wrong, in plain English. */
  message: string;
}

/**
 * The error to throw when a request cannot be completed for a reason the CALLER should know about
 * (a business rule, a missing item, a conflict).
 *
 *   throw new DomainError('DISCOUNT_EXCEEDS_LIMIT', 'Maximum allowed is 5%.');
 *
 * The HTTP status and title come from the catalogue (error-codes.ts), so they cannot drift.
 * `detail` is shown to the user, so write it as a helpful sentence and never put secrets, SQL or
 * internal names in it. Unexpected bugs should NOT use this class: let them throw normally and
 * the filter will turn them into a safe 500 and report them.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    /** Human-readable explanation shown to the user. Optional. */
    public readonly detail?: string,
    /** Per-field problems, for validation-style errors. */
    public readonly errors?: FieldError[],
    /** Extra response headers, for example `Retry-After` on a rate-limit error. */
    public readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(detail ?? code);
    this.name = 'DomainError';
  }
}
