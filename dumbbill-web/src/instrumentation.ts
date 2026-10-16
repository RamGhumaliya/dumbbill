import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/observability/sentry-options';

/**
 * Runs once when the Next.js server starts. Switches on Sentry for errors that happen on the server
 * (while rendering a page, in the proxy). It does nothing when no Sentry address is configured.
 */
export function register(): void {
  const options = sentryOptions();
  if (options) Sentry.init(options);
}

/** Next.js calls this for every server-side request error, so it can be reported. No-op when Sentry is off. */
export const onRequestError = Sentry.captureRequestError;
