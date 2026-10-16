import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { FieldError } from '../errors/domain-error';
import { ERROR_CODES, ErrorCode } from '../errors/error-codes';
import { ProblemDetailsDto } from './problem-details.dto';

export interface ApiProblemOptions {
  /** Shown in Swagger next to the status. Defaults to the catalogue title. */
  description?: string;
  /** Example `detail` text in the sample response. */
  detail?: string;
  /** Example per-field problems (for VALIDATION_FAILED). */
  errors?: FieldError[];
}

/**
 * Documents one error response of an endpoint in Swagger, using the standard error body and a
 * ready-made example. The status comes from the error catalogue, so docs and behaviour cannot disagree.
 *
 *   @ApiProblemResponse('NOT_FOUND', { detail: 'No product with this id.' })
 *   @ApiProblemResponse('VALIDATION_FAILED', { errors: [{ field: 'name', message: 'should not be empty' }] })
 *
 * Every endpoint must document the errors it can return (see docs/03-engineering/api-docs-standard.md);
 * the Swagger completeness test fails if it does not.
 */
export function ApiProblemResponse(
  code: ErrorCode,
  options: ApiProblemOptions = {},
): MethodDecorator & ClassDecorator {
  const info = ERROR_CODES[code];
  const example = {
    type: `https://api.dumbbill.in/errors/${code.toLowerCase().replace(/_/g, '-')}`,
    title: info.title,
    status: info.status,
    code,
    ...(options.detail ? { detail: options.detail } : {}),
    requestId: '01JA0000000000000000000000',
    ...(options.errors ? { errors: options.errors } : {}),
  };
  return applyDecorators(
    ApiExtraModels(ProblemDetailsDto),
    ApiResponse({
      status: info.status,
      description: options.description ?? `${info.title} (code \`${code}\`).`,
      content: {
        'application/problem+json': {
          schema: { $ref: getSchemaPath(ProblemDetailsDto) },
          example,
        },
      },
    }),
  );
}
