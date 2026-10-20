import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { validationExceptionFactory } from './common/errors/validation';
import { ErrorReporter, reportError } from './observability/sentry';

/**
 * Settings applied to the running app. Kept separate from main.ts so the automated tests
 * start the app with exactly the same rules as production.
 *
 * `reporter` sends unexpected errors to Sentry; tests pass a fake one to check what would be sent.
 */
export function configureApp(app: INestApplication, reporter: ErrorReporter = reportError): void {
  const logger = app.get(Logger);
  // Small test apps are built without the settings module; they get the safe defaults (no proxy, no CORS origin).
  let config: ConfigService | undefined;
  try {
    config = app.get(ConfigService, { strict: false });
  } catch {
    config = undefined;
  }

  // How many proxies (load balancer, CDN) sit in front of us. This decides which part of `X-Forwarded-For` is
  // trusted as the visitor's IP. Too high and visitors can fake their address (breaking rate limits); too low
  // and every visitor looks like the proxy. The default 0 trusts nothing.
  const hops = config?.get<number>('TRUST_PROXY_HOPS') ?? 0;
  if (hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops);

  // Security headers on every answer (no sniffing, no framing, no referrer leaks, HSTS). The API only returns JSON and
  // images, so its content policy forbids everything; the Swagger pages under /docs need their own scripts and styles,
  // so they get the other headers without the policy.
  const strict = helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  const forDocs = helmet({ contentSecurityPolicy: false });
  app.use((request: Request, response: Response, next: NextFunction) =>
    (request.path.startsWith('/docs') ? forDocs : strict)(request, response, next),
  );

  // Browsers may call the API only from the web origins we list (never `*`, which cannot be combined with
  // cookies). `credentials: true` lets the browser send the refresh cookie; the allowed headers include the CSRF
  // header and the idempotency key; the exposed headers let the web app read the request id and retry hint.
  app.enableCors({
    origin: (config?.get<string>('CORS_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'Idempotency-Key',
      'If-Match',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  // Reads cookies into `request.cookies` (needed for the browser refresh-token cookie).
  app.use(cookieParser());

  // Send Nest's own log messages through our JSON logger too.
  app.useLogger(logger);

  // Turn every failure into the standard error body (RFC 9457) with a request id.
  app.useGlobalFilters(new ProblemDetailsFilter(logger, reporter));

  // Check every incoming request body, query and parameter against its DTO class.
  //  - whitelist: silently drop fields the DTO does not declare
  //  - forbidNonWhitelisted: ...but reject the request instead if any such field is sent.
  //    This stops clients from sneaking in fields like "tenantId" or "role".
  //  - transform: convert plain JSON into DTO class instances (and "5" into the number 5).
  //  - exceptionFactory: report problems in the standard VALIDATION_FAILED format, field by field.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // On SIGTERM (a normal stop) finish in-flight requests and close DB connections cleanly.
  app.enableShutdownHooks();
}
