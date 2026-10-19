import { ApiError } from '@/lib/api';

/** The sentences a screen offers for the failures that need their own wording. */
export interface FailureMessages {
  title: string;
  network: string;
  forbidden: string;
  generic: string;
}

/** What to show a person when a business or branch call failed. */
export interface FailureView {
  title: string;
  body: string;
  /** Only for failures the person cannot fix; lets support find the exact request in the logs. */
  reference?: string;
}

/**
 * Turn a failed business or branch call into words for a person. Behaviour is chosen from the error CODE
 * (docs/api/error-codes.md), never from the server's English text.
 *
 * Field problems (a bad GSTIN, a prefix already used) are NOT handled here: forms show them next to the field with
 * `applyServerErrors`. Plan-limit and last-branch failures are handled by the screens that can explain them.
 */
export function describeFailure(error: unknown, messages: FailureMessages): FailureView {
  if (error instanceof ApiError) {
    if (error.isNetwork) return { title: messages.title, body: messages.network };
    if (error.code === 'FORBIDDEN') return { title: messages.title, body: messages.forbidden };
    return { title: messages.title, body: messages.generic, reference: error.requestId };
  }
  return { title: messages.title, body: messages.generic };
}
