import type { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';

/** The translator for the "Auth" messages (see messages/en.json). */
export type AuthT = ReturnType<typeof useTranslations<'Auth'>>;

/** What to show a person when a call failed: a short title, a sentence, and the reference to quote to support. */
export interface ErrorView {
  title: string;
  body: string;
  /** Only for failures the person cannot fix themselves; it lets support find the exact request in the logs. */
  reference?: string;
}

/**
 * Turn any failure of an auth call into words for a person.
 *
 * Behaviour is chosen from the error CODE (docs/api/error-codes.md), never from the server's English text, which
 * may change. Three rules from the auth guide (docs/api/auth-flow.md):
 *  - one generic message for a wrong email OR password: never say which, never hint that the account exists;
 *  - a rate limit says how long to wait (taken from the `Retry-After` header);
 *  - an unexpected failure shows its reference, because only support can fix it.
 */
export function describeApiError(error: unknown, t: AuthT): ErrorView {
  if (error instanceof ApiError) {
    if (error.isNetwork) {
      return { title: t('errors.problemTitle'), body: t('errors.network') };
    }
    if (error.code === 'RATE_LIMITED') {
      return {
        title: t('errors.problemTitle'),
        body: error.retryAfterSeconds
          ? t('errors.locked', { seconds: error.retryAfterSeconds })
          : t('errors.lockedNoTime'),
      };
    }
    if (error.code === 'INVALID_TOTP_CODE') {
      return { title: t('errors.problemTitle'), body: t('errors.invalidTotp') };
    }
    if (error.code === 'INVALID_CREDENTIALS') {
      return { title: t('errors.invalidCredentialsTitle'), body: t('errors.invalidCredentials') };
    }
    return {
      title: t('errors.problemTitle'),
      body: t('errors.generic'),
      reference: error.requestId,
    };
  }
  return { title: t('errors.problemTitle'), body: t('errors.generic') };
}
