import { z } from 'zod';

/**
 * How API failures are represented in the web app.
 *
 * The server answers every failure with the same body (RFC 9457 "problem details", content type
 * application/problem+json). See docs/api/error-codes.md for every code. This file turns that body into
 * one error class, `ApiError`, so screens deal with a single, predictable shape.
 *
 * Decide behaviour from `code`, never from `title` or `detail`: the text may change, codes are stable.
 */

/** One problem with one input field (validation errors). */
export const fieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/** The error body sent by the server. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  requestId: z.string(),
  errors: z.array(fieldErrorSchema).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/**
 * Failures that happen on the user's side of the wire, so the server never produced a code.
 *  NETWORK_ERROR      no connection, server down, blocked by the browser
 *  TIMEOUT            no answer in time
 *  INVALID_RESPONSE   the server answered, but not in the shape the API manual promises (a bug to report)
 *  UNEXPECTED_RESPONSE  an error status without the standard error body (for example from a proxy)
 */
export type ClientErrorCode =
  'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'UNEXPECTED_RESPONSE';

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when no response was received. */
    public readonly status: number,
    /** Server error code (see docs/api/error-codes.md) or a ClientErrorCode. */
    public readonly code: string,
    /** Short title from the server, or a generic one for client-side failures. */
    public readonly title: string,
    /** The reference to show the user and quote to support. Always present. */
    public readonly requestId: string,
    /** Explanation from the server that is safe to show to the user. */
    public readonly detail?: string,
    /** Per-field problems, for forms. */
    public readonly fieldErrors: FieldError[] = [],
    /** Seconds to wait before trying again, from the `Retry-After` header of a rate-limit (429) answer. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(detail ?? title);
    this.name = 'ApiError';
  }

  /** Build from a parsed problem body (and the `Retry-After` header, when the server sent one). */
  static fromProblem(problem: ProblemDetails, retryAfterSeconds?: number): ApiError {
    return new ApiError(
      problem.status,
      problem.code,
      problem.title,
      problem.requestId,
      problem.detail,
      problem.errors ?? [],
      retryAfterSeconds,
    );
  }

  /** True when the user must sign in again (401). */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** True for connection problems, where retrying later may work. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

/** Parse an error body. Returns undefined when it is not the standard format. */
export function parseProblem(body: unknown): ProblemDetails | undefined {
  const result = problemDetailsSchema.safeParse(body);
  return result.success ? result.data : undefined;
}
