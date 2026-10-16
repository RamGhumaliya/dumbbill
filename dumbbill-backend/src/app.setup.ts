import { INestApplication, ValidationPipe } from '@nestjs/common';
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
