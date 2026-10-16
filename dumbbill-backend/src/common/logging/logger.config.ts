import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { trace } from '@opentelemetry/api';
import type { DestinationStream } from 'pino';
import { stdTimeFunctions } from 'pino';
import type { Params } from 'nestjs-pino';
import { getTenantContext } from '../../modules/tenancy/tenant-context';
import { assignRequestId, RequestWithId } from '../request-context/request-context.middleware';
import { scrub } from './redaction';

export interface LoggerSettings {
  /** Minimum importance written: fatal, error, warn, info or debug. */
  level: string;
  /** Production writes one JSON object per line; development prints readable coloured lines. */
  isProduction: boolean;
  /** Environment name added to every line (`production`, `development`). */
  environment: string;
  /** App version added to every line, so a log line can be matched to a release. */
  version: string;
  /** Where to write. Tests pass an in-memory stream; the app leaves it unset (standard output). */
  stream?: DestinationStream;
}

/** A short, one-way fingerprint of an id: enough to follow one user across logs without writing the raw id. */
function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Builds the logger settings used by the whole API.
 *
 * Every log line carries:
 *   service, env, version     which program and release wrote it
 *   requestId                 ties all lines (and the error response) of one API call together
 *   tenantId, userId          which business and (fingerprinted) user, once the request is authenticated
 *   traceId, spanId           links to tracing, when tracing is switched on
 *
 * Secrets are removed by `scrub` (see redaction.ts). Request and response details are reduced to a
 * short safe summary on purpose: no headers, no query string, no body.
 */
export function buildLoggerParams(settings: LoggerSettings): Params {
  const options: NonNullable<Exclude<Params['pinoHttp'], DestinationStream | unknown[]>> = {
    level: settings.level,
    timestamp: stdTimeFunctions.isoTime,

    // Fixed fields written on every line.
    base: { service: 'dumbbill-api', env: settings.environment, version: settings.version },

    // One id per request, shared with the middleware and the error filter.
    genReqId: (req, res) => assignRequestId(req as RequestWithId, res as never),
    // ...and written as `requestId` on EVERY line of that request (including lines from services).
    customProps: (req) => ({ requestId: (req as RequestWithId).requestId }),

    // Extra fields added to every line, including lines written by services via the Nest logger.
    mixin() {
      // (requestId is NOT added here: `customProps` above already adds it to every line of the request.)
      const extra: Record<string, string> = {};
      const tenant = getTenantContext();
      if (tenant) {
        extra.tenantId = tenant.tenantId;
        if (tenant.userId) extra.userId = fingerprint(tenant.userId);
      }
      const span = trace.getActiveSpan()?.spanContext();
      if (span) {
        extra.traceId = span.traceId;
        extra.spanId = span.spanId;
      }
      return extra;
    },

    // Last line of defence: remove secrets and shorten personal data in whatever was logged.
    formatters: { log: (object) => scrub(object) as Record<string, unknown> },

    // Belt and braces: even if headers were logged some day, these never are.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },

    // Keep the "request completed" line small and safe: method, path without query string, status.
    serializers: {
      req: (req: IncomingMessage & { originalUrl?: string }) => ({
        method: req.method,
        path: (req.originalUrl ?? req.url ?? '').split('?')[0],
        remoteAddress: req.socket?.remoteAddress,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },

    // Server errors are errors, client mistakes are warnings, the rest is information.
    customLogLevel: (_req, res, error) =>
      error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',

    // Health checks run every few seconds; logging them would drown out real traffic.
    autoLogging: { ignore: (req) => req.url === '/healthz' },

    ...(settings.isProduction || settings.stream
      ? {}
      : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
  };

  return { pinoHttp: settings.stream ? [options, settings.stream] : options };
}
