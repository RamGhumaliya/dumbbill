import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ErrorReporter } from '../../observability/sentry';
import { getTenantContext } from '../../modules/tenancy/tenant-context';
import { getRequestContext } from '../request-context/request-context';
import { newRequestId } from '../request-context/request-id';
import { RequestWithId } from '../request-context/request-context.middleware';
import { mapExceptionToProblem } from './problem-details';

/**
 * The single place where every failure becomes an HTTP response.
 *
 * Whatever goes wrong anywhere in the app (a validation error, a missing item, a bug, a database
 * outage), the caller receives the same standard JSON body (see problem-details.ts) with a stable
 * `code` and a `requestId`. This filter also decides what is written to the logs and what is sent
 * to Sentry:
 *
 *   expected problems (4xx)   not logged here; the "request completed" line already records the status
 *   cross-business access     logged as a security warning (event `rls.violation`)
 *   unexpected failures (5xx) logged as an error WITH the stack trace, and reported to Sentry
 *
 * The caller never sees the stack trace, SQL or internal messages of an unexpected failure.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly report: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();

    // The id was assigned at the start of the request; creating one here is only a last resort.
    const requestId = getRequestContext()?.requestId ?? request.requestId ?? newRequestId();
    const { problem, unexpected, securityEvent } = mapExceptionToProblem(exception, requestId);

    if (unexpected) {
      // nestjs-pino's Logger treats a trailing string argument as a "context", so the message goes inside the object.
      this.logger.error({
        msg: 'Unexpected error',
        err: exception,
        code: problem.code,
        status: problem.status,
      });
      this.report(exception, {
        requestId,
        tenantId: getTenantContext()?.tenantId,
        code: String(problem.code),
      });
    } else if (securityEvent) {
      this.logger.warn({
        msg: 'Blocked an attempt to access data of another business',
        event: 'rls.violation',
        err: exception,
      });
    }

    // If the response already started streaming we can no longer change it.
    if (response.headersSent) return;
    response.setHeader('X-Request-Id', requestId);
    response.status(problem.status).type('application/problem+json').json(problem);
  }
}
