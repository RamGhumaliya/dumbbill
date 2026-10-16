import * as Sentry from '@sentry/node';
import { scrub } from '../common/logging/redaction';

/**
 * Sentry = the service that collects unexpected errors from production, groups them, and tells us.
 *
 * It is OFF unless SENTRY_DSN is set, so development and tests send nothing anywhere.
 * Only unexpected failures (HTTP 500 and above) are reported; normal client mistakes such as
 * "not found" or "invalid field" are not errors in our system and would only add noise.
 */
export interface SentrySettings {
  /** Project address from Sentry. Empty or missing turns Sentry off. */
  dsn: string | undefined;
  /** `development` or `production`. */
  environment: string;
  /** App version, so each error can be matched to a release. */
  release: string;
}

/** Start Sentry. Returns true if it is now active. Safe to call when no DSN is configured. */
export function initSentry({ dsn, environment, release }: SentrySettings): boolean {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment,
    release,
    // Sentry 11 collects cookies, headers, bodies, query strings and user info BY DEFAULT.
    // We switch every one of them off: reports must never carry customer or secret data.
    // (beforeSend below strips the same things again, in case a future version changes a default.)
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    // Errors only. Performance tracing is handled separately by OpenTelemetry (observability/tracing.ts).
    tracesSampleRate: 0,
    beforeSend(event) {
      // Strip anything that could carry customer or secret data before it leaves the server.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        delete event.request.query_string;
      }
      delete event.user;
      if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
      return event;
    },
  });
  return true;
}

/** Extra facts attached to a report so the team can search by them in Sentry. */
export interface ReportTags {
  requestId: string;
  tenantId?: string;
  code?: string;
}

/** Function shape used by the error filter. Tests pass a fake one. */
export type ErrorReporter = (error: unknown, tags: ReportTags) => void;

/** Send an unexpected error to Sentry, tagged with the request id. Does nothing if Sentry is off. */
export const reportError: ErrorReporter = (error, tags) => {
  if (!Sentry.isInitialized()) return;
  Sentry.withScope((scope) => {
    scope.setTag('requestId', tags.requestId);
    if (tags.tenantId) scope.setTag('tenantId', tags.tenantId);
    if (tags.code) scope.setTag('code', tags.code);
    Sentry.captureException(error);
  });
};
