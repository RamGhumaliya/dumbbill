import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DomainError } from '../../src/common/errors/domain-error';
import { ERROR_CODES } from '../../src/common/errors/error-codes';
import { mapExceptionToProblem } from '../../src/common/errors/problem-details';
import {
  StorageObjectNotFoundError,
  StorageValidationError,
} from '../../src/modules/storage/storage.types';

const RID = '01JA0000000000000000000000';

/** Builds an error shaped like the ones Prisma throws (matched by class name, so no database is needed). */
function prismaError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.name = 'PrismaClientKnownRequestError';
  error.code = code;
  return error;
}

/**
 * Every failure must become the same safe, predictable response. These tests pin the mapping
 * from "what was thrown" to "what the caller receives".
 */
describe('mapExceptionToProblem', () => {
  it('maps a DomainError using the catalogue status, title and code', () => {
    const { problem, unexpected } = mapExceptionToProblem(
      new DomainError('DISCOUNT_EXCEEDS_LIMIT', 'Maximum allowed is 5%.'),
      RID,
    );
    expect(problem).toEqual({
      type: 'https://api.dumbbill.in/errors/discount-exceeds-limit',
      title: 'Discount exceeds your limit',
      status: 422,
      code: 'DISCOUNT_EXCEEDS_LIMIT',
      detail: 'Maximum allowed is 5%.',
      requestId: RID,
    });
    expect(unexpected).toBe(false);
  });

  it('includes per-field errors for validation failures', () => {
    const { problem } = mapExceptionToProblem(
      new DomainError('VALIDATION_FAILED', 'One or more fields are invalid.', [
        { field: 'name', message: 'should not be empty' },
      ]),
      RID,
    );
    expect(problem.status).toBe(400);
    expect(problem.errors).toEqual([{ field: 'name', message: 'should not be empty' }]);
  });

  it('maps Nest HTTP errors: unknown route -> 404 NOT_FOUND', () => {
    const { problem } = mapExceptionToProblem(new NotFoundException('Cannot GET /nope'), RID);
    expect(problem).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('accepts a custom code, title and detail carried by an HTTP exception (used by /readyz)', () => {
    const { problem, unexpected } = mapExceptionToProblem(
      new ServiceUnavailableException({
        code: 'NOT_READY',
        title: 'Service not ready',
        detail: 'Database is unreachable.',
      }),
      RID,
    );
    expect(problem).toMatchObject({
      status: 503,
      code: 'NOT_READY',
      title: 'Service not ready',
      detail: 'Database is unreachable.',
    });
    expect(unexpected).toBe(true); // a 5xx is something the team should hear about
  });

  it('ignores an unknown code carried by an HTTP exception and falls back to the status', () => {
    const { problem } = mapExceptionToProblem(
      new BadRequestException({ code: 'NOT_IN_CATALOGUE' }),
      RID,
    );
    expect(problem.code).toBe('BAD_REQUEST');
  });

  describe('storage errors', () => {
    it.each([
      ['INVALID_KEY', 'FILE_INVALID_KEY', 400],
      ['FILE_TOO_LARGE', 'FILE_TOO_LARGE', 413],
      ['EMPTY_FILE', 'FILE_EMPTY', 422],
      ['TYPE_NOT_ALLOWED', 'FILE_TYPE_NOT_ALLOWED', 415],
      ['CONTENT_MISMATCH', 'FILE_CONTENT_MISMATCH', 422],
    ] as const)('%s -> %s (%i)', (storageCode, expectedCode, status) => {
      const { problem } = mapExceptionToProblem(
        new StorageValidationError(storageCode, 'message'),
        RID,
      );
      expect(problem).toMatchObject({ code: expectedCode, status });
    });

    it('missing file -> 404 FILE_NOT_FOUND', () => {
      expect(mapExceptionToProblem(new StorageObjectNotFoundError('k'), RID).problem).toMatchObject(
        { code: 'FILE_NOT_FOUND', status: 404 },
      );
    });
  });

  describe('database errors', () => {
    it('a row-level-security refusal looks like "not found" (never confirms the other row exists) and is a security event', () => {
      const result = mapExceptionToProblem(
        prismaError('P2010', 'new row violates row-level security policy for table "users"'),
        RID,
      );
      expect(result.problem).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect(result.problem.detail).toBeUndefined();
      expect(result.securityEvent).toBe(true);
      expect(result.unexpected).toBe(false);
    });

    it('unique violation -> 409 CONFLICT without revealing column names', () => {
      const { problem } = mapExceptionToProblem(
        prismaError('P2002', 'Unique constraint failed on the fields: (`email`)'),
        RID,
      );
      expect(problem).toMatchObject({ status: 409, code: 'CONFLICT' });
      expect(JSON.stringify(problem)).not.toContain('email');
    });

    it('record not found -> 404', () => {
      expect(
        mapExceptionToProblem(prismaError('P2025', 'Record to update not found.'), RID).problem
          .status,
      ).toBe(404);
    });
  });

  describe('unexpected failures', () => {
    it('become a generic 500 that reveals nothing about the cause', () => {
      const { problem, unexpected } = mapExceptionToProblem(
        new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2 /srv/app/secret.ts:42'),
        RID,
      );
      expect(unexpected).toBe(true);
      expect(problem).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', requestId: RID });
      const text = JSON.stringify(problem);
      for (const leaked of ['ECONNREFUSED', '10.0.0.5', 'hunter2', 'secret.ts']) {
        expect(text).not.toContain(leaked);
      }
      expect(problem.detail).toContain(RID); // the user can quote the reference
    });

    it('treat non-Error throws (strings, null) the same way', () => {
      expect(mapExceptionToProblem('just a string', RID).problem.code).toBe('INTERNAL_ERROR');
      expect(mapExceptionToProblem(null, RID).problem.code).toBe('INTERNAL_ERROR');
    });
  });

  it('keeps the catalogue consistent: every code has a status 400-599, a title and a UI hint', () => {
    for (const [code, info] of Object.entries(ERROR_CODES)) {
      expect(info.status).toBeGreaterThanOrEqual(400);
      expect(info.status).toBeLessThan(600);
      expect(info.title.length).toBeGreaterThan(3);
      expect(info.uiHint.length).toBeGreaterThan(10);
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
    }
  });
});
