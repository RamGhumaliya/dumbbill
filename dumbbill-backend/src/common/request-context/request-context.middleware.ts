import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { resolveRequestId } from './request-id';
import { runWithRequestContext } from './request-context';

/** Name of the header carrying the request id, in both directions. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Express request with the id we attach to it. */
export type RequestWithId = Request & { requestId?: string };

/**
 * Gives every request an id and makes it available everywhere.
 *
 * 1. Reuse the caller's `X-Request-Id` if it is safe, otherwise create one.
 * 2. Echo it back in the `X-Request-Id` response header, so even a successful response can be traced.
 * 3. Run the rest of the request inside an AsyncLocalStorage scope holding the id.
 *
 * The id is also stored on the request object, which is how the logger (pino-http) and the error
 * filter read the same value. `assignRequestId` is shared with the logger so that, whichever of the
 * two runs first, they agree on one id.
 */
export function assignRequestId(req: RequestWithId, res: Response): string {
  if (req.requestId) return req.requestId; // already assigned earlier in this request
  const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  return id;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const requestId = assignRequestId(req, res);
    runWithRequestContext({ requestId }, next);
  }
}
