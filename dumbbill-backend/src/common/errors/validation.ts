import { ValidationError } from 'class-validator';
import { DomainError, FieldError } from './domain-error';

/**
 * Turns class-validator's nested error tree into a flat list of `{ field, message }`, where field is
 * a dotted path such as `items.0.quantity`.
 *
 * The rejected VALUE is deliberately never included: it could be a password or other private data,
 * and error bodies are logged and shown on screen.
 */
export function flattenValidationErrors(errors: ValidationError[], parentPath = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/**
 * Plug into `new ValidationPipe({ exceptionFactory })`: invalid input becomes a standard
 * `VALIDATION_FAILED` problem with one entry per bad field.
 */
export function validationExceptionFactory(errors: ValidationError[]): DomainError {
  return new DomainError(
    'VALIDATION_FAILED',
    'One or more fields are invalid.',
    flattenValidationErrors(errors),
  );
}
