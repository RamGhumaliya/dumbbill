import { ApiError } from '@/lib/api';
import type { FailureMessages, FailureView } from '../business/business-errors';

/**
 * Turn a failed team call into words. Unlike most screens, the server's own sentence is shown for the rules a person
 * can act on, because it names exactly what is wrong ("You can only grant permissions you hold yourself. Missing:
 * invoice.refund", "2 people still have this role"). What to DO is still decided by the error CODE, never the text.
 * Anything unexpected shows the request reference so support can find it.
 */
export function describeTeamFailure(error: unknown, messages: FailureMessages): FailureView {
  if (error instanceof ApiError) {
    if (error.isNetwork) return { title: messages.title, body: messages.network };
    const explained = ['FORBIDDEN', 'CONFLICT', 'PLAN_LIMIT_REACHED', 'BUSINESS_RULE_VIOLATION'];
    if (explained.includes(error.code)) {
      return {
        title: messages.title,
        body: error.detail ?? (error.code === 'FORBIDDEN' ? messages.forbidden : messages.generic),
      };
    }
    return { title: messages.title, body: messages.generic, reference: error.requestId };
  }
  return { title: messages.title, body: messages.generic };
}
