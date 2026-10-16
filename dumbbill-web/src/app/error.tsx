'use client';

import * as Sentry from '@sentry/nextjs';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Shown when something unexpected breaks while a page is showing. Replaces the broken part of the
 * screen instead of leaving a blank page.
 *
 * It always shows a REFERENCE the user can read out to support:
 *   - for a failed API call, the requestId (finds the call in the server logs)
 *   - for a failure while the server built the page, Next.js's `digest` (finds it in the server logs)
 * The technical message itself is never shown: it could reveal internals.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    // Reports the error to Sentry. Does nothing when Sentry is switched off.
    Sentry.captureException(error);
  }, [error]);

  const reference = error instanceof ApiError ? error.requestId : error.digest;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-display font-bold tracking-wide uppercase">
        {t('Errors.pageTitle')}
      </h1>
      <p className="text-body text-muted">{t('Errors.pageBody')}</p>
      {reference && (
        <p className="font-mono text-small">{t('Common.reference', { code: reference })}</p>
      )}
      <div>
        <button
          type="button"
          onClick={reset}
          className="rounded-control bg-accent px-4 py-2.5 text-small font-medium text-on-accent"
        >
          {t('Common.tryAgain')}
        </button>
      </div>
    </main>
  );
}
