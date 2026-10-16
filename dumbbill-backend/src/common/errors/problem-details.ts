import { HttpException } from '@nestjs/common';
import {
  StorageObjectNotFoundError,
  StorageValidationError,
} from '../../modules/storage/storage.types';
import { DomainError, FieldError } from './domain-error';
import { codeForStatus, ERROR_CODES, ErrorCode, isErrorCode } from './error-codes';

/**
 * The error body every failed request returns, following RFC 9457 "Problem Details for HTTP APIs"
 * (content type `application/problem+json`).
 */
export interface ProblemDetails {
  /** A URL that identifies the kind of problem. Built from the code. */
  type: string;
  /** Short title for the kind of problem. */
  title: string;
  /** HTTP status, repeated in the body for convenience. */
  status: number;
  /** Stable machine-readable code. Apps decide behaviour from this. See docs/api/error-codes.md. */
  code: ErrorCode | string;
  /** Explanation for this occurrence. Safe to show to the user. */
  detail?: string;
  /** Quote this to support; it finds the full story in the logs. */
  requestId: string;
  /** Per-field problems (validation errors). */
  errors?: FieldError[];
}

/** What the mapper returns: the body, plus facts the filter needs for logging and reporting. */
export interface MappedProblem {
  problem: ProblemDetails;
  /** True for unexpected failures, which are logged as errors and sent to Sentry. */
  unexpected: boolean;
  /** True when the database refused a cross-business access: logged as a security event. */
  securityEvent: boolean;
}

const PROBLEM_TYPE_BASE = 'https://api.dumbbill.in/errors';

/** Build the standard body from a catalogue code. */
export function buildProblem(
  code: ErrorCode,
  requestId: string,
  extra: { detail?: string; errors?: FieldError[]; title?: string } = {},
): ProblemDetails {
  const info = ERROR_CODES[code];
  return {
    type: `${PROBLEM_TYPE_BASE}/${code.toLowerCase().replace(/_/g, '-')}`,
    title: extra.title ?? info.title,
    status: info.status,
    code,
    ...(extra.detail ? { detail: extra.detail } : {}),
    requestId,
    ...(extra.errors?.length ? { errors: extra.errors } : {}),
  };
}

/** The message shown for unexpected failures. It deliberately says nothing about the cause. */
function genericServerDetail(requestId: string): string {
  return `Something went wrong on our side. If it keeps happening, tell support this reference: ${requestId}.`;
}

/** Prisma errors have these class names; compared by name to avoid depending on its internals. */
function isPrismaError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && error.name.startsWith('PrismaClient');
}

/** Errors thrown by Express middleware (for example a malformed JSON body) carry a status and `expose`. */
function isExposedHttpError(
  error: unknown,
): error is { status?: number; statusCode?: number; expose?: boolean; message: string } {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  return candidate.expose === true && typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Turn ANY thrown thing into a safe, standard problem response.
 *
 * Order matters: specific known errors first, then generic HTTP errors, and finally "anything else"
 * becomes a 500 whose message reveals nothing (no stack trace, no SQL, no file paths).
 */
export function mapExceptionToProblem(exception: unknown, requestId: string): MappedProblem {
  const known = (problem: ProblemDetails): MappedProblem => ({
    problem,
    unexpected: false,
    securityEvent: false,
  });

  // 1. Our own business errors.
  if (exception instanceof DomainError) {
    return known(
      buildProblem(exception.code, requestId, {
        detail: exception.detail,
        errors: exception.errors,
      }),
    );
  }

  // 2. File storage errors.
  if (exception instanceof StorageObjectNotFoundError) {
    return known(buildProblem('FILE_NOT_FOUND', requestId));
  }
  if (exception instanceof StorageValidationError) {
    const byStorageCode = {
      INVALID_KEY: 'FILE_INVALID_KEY',
      FILE_TOO_LARGE: 'FILE_TOO_LARGE',
      EMPTY_FILE: 'FILE_EMPTY',
      TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
      CONTENT_MISMATCH: 'FILE_CONTENT_MISMATCH',
    } as const satisfies Record<StorageValidationError['code'], ErrorCode>;
    return known(
      buildProblem(byStorageCode[exception.code], requestId, { detail: exception.message }),
    );
  }

  // 3. Database errors we can explain safely.
  if (isPrismaError(exception)) {
    // The database refused because the row belongs to another business. Tell the caller "not found"
    // (never confirm that the other row exists) and flag it as a security event for the logs.
    if (/row-level security/i.test(exception.message)) {
      return {
        problem: buildProblem('NOT_FOUND', requestId),
        unexpected: false,
        securityEvent: true,
      };
    }
    if (exception.code === 'P2002')
      return known(
        buildProblem('CONFLICT', requestId, {
          detail: 'A record with these details already exists.',
        }),
      );
    if (exception.code === 'P2003')
      return known(
        buildProblem('CONFLICT', requestId, { detail: 'This record is linked to other records.' }),
      );
    if (exception.code === 'P2025') return known(buildProblem('NOT_FOUND', requestId));
  }

  // 4. Nest HTTP exceptions (404 for unknown routes, 403 from guards, our own `new XException({code, ...})`).
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const fields =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const code = isErrorCode(fields.code) ? fields.code : codeForStatus(status);
    const detail =
      typeof fields.detail === 'string'
        ? fields.detail
        : typeof body === 'string'
          ? body
          : undefined;
    const mapped = buildProblem(code, requestId, {
      title: typeof fields.title === 'string' ? fields.title : undefined,
      detail,
    });
    // Keep the exception's own status (for example 429 with a custom code), the catalogue is the default.
    return { problem: { ...mapped, status }, unexpected: status >= 500, securityEvent: false };
  }

  // 5. Errors from Express middleware that are safe to explain (malformed JSON, body too large).
  if (isExposedHttpError(exception)) {
    const status = exception.status ?? exception.statusCode ?? 400;
    return known({ ...buildProblem(codeForStatus(status), requestId), status });
  }

  // 6. Everything else is a bug or an outage. Say nothing about it to the caller.
  return {
    problem: buildProblem('INTERNAL_ERROR', requestId, { detail: genericServerDetail(requestId) }),
    unexpected: true,
    securityEvent: false,
  };
}
