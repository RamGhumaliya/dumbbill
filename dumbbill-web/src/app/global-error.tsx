'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * The last safety net: used only if the root layout itself fails, in which case none of the usual
 * providers (translations, theme) exist. It therefore has to bring its own <html> and <body>, uses
 * no translation system, and keeps its styling to the bare minimum.
 * (English text is fine here; this screen should essentially never be seen.)
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main id="main">
          <h1>Something went wrong</h1>
          <p>The application could not start. Please reload the page.</p>
          {error.digest && <p>Reference: {error.digest}</p>}
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
