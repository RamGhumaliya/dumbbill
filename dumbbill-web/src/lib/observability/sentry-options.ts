import type * as Sentry from '@sentry/nextjs';
import { env } from '../env';

/**
 * Sentry = the service that collects unexpected errors, groups them and tells us.
 *
 * Returns the settings to start it with, or undefined when NEXT_PUBLIC_SENTRY_DSN is empty. In that
 * case Sentry is never started: nothing is sent anywhere, in development or in tests.
 *
 * Sentry 11 collects cookies, headers, request bodies, query strings and user info BY DEFAULT.
 * We turn every one of them off: error reports must never carry customer or secret data
 * (the same rule as the backend). beforeSend removes them again as a second safety net.
 */
export function sentryOptions(): Parameters<typeof Sentry.init>[0] | undefined {
  const dsn = env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return undefined;
  return {
    dsn,
    environment: env.APP_ENV,
    release: env.NEXT_PUBLIC_APP_VERSION,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    // Errors only. No performance tracing and no session replay (a replay could record a customer's screen).
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
  };
}
