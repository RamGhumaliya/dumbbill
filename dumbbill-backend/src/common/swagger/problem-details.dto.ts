import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FieldError } from '../errors/domain-error';

/** Swagger description of one field problem. Mirrors `FieldError`. */
export class FieldErrorDto implements FieldError {
  @ApiProperty({
    example: 'discount.value',
    description: 'Dotted path of the field that has a problem.',
  })
  field!: string;

  @ApiProperty({
    example: 'must not be greater than 100',
    description: 'What is wrong, in plain English.',
  })
  message!: string;
}

/**
 * Swagger description of the error body returned for every failed request (RFC 9457).
 * Mirrors the `ProblemDetails` interface in common/errors/problem-details.ts.
 */
export class ProblemDetailsDto {
  @ApiProperty({
    example: 'https://api.dumbbill.in/errors/discount-exceeds-limit',
    description: 'URL identifying the kind of problem.',
  })
  type!: string;

  @ApiProperty({
    example: 'Discount exceeds your limit',
    description: 'Short title for the kind of problem.',
  })
  title!: string;

  @ApiProperty({ example: 422, description: 'HTTP status code, repeated in the body.' })
  status!: number;

  @ApiProperty({
    example: 'DISCOUNT_EXCEEDS_LIMIT',
    description:
      'Stable machine-readable code. Apps decide behaviour from this, not from the text. Full list: docs/api/error-codes.md.',
  })
  code!: string;

  @ApiPropertyOptional({
    example: 'Maximum allowed is 5%.',
    description: 'Explanation of this occurrence, safe to show to the user.',
  })
  detail?: string;

  @ApiProperty({
    example: '01JA0000000000000000000000',
    description:
      'Request reference. Also sent in the X-Request-Id response header. Quote it to support.',
  })
  requestId!: string;

  @ApiPropertyOptional({
    type: [FieldErrorDto],
    description: 'Per-field problems (validation errors).',
  })
  errors?: FieldErrorDto[];
}
