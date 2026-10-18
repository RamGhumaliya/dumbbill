'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback } from 'react';
import { useForm, type FieldValues, type UseFormProps } from 'react-hook-form';
import type { z } from 'zod';
import { applyApiErrors } from './apply-api-errors';

/**
 * The standard way to build a form: react-hook-form + a zod schema, plus a helper for server errors.
 *
 *   const schema = z.object({ name: z.string().min(1) });
 *   const form = useApiForm(schema, { defaultValues: { name: '' } });
 *   ...
 *   try { await save(values); } catch (e) { if (!form.applyServerErrors(e)) showGeneralError(e); }
 *
 * The schema is the single description of what a valid value looks like; the same schema type-checks the
 * values the submit handler receives.
 */
export function useApiForm<TInput extends FieldValues, TOutput extends FieldValues = TInput>(
  schema: z.ZodType<TOutput, TInput>,
  options?: Omit<UseFormProps<TInput, unknown, TOutput>, 'resolver'>,
) {
  const form = useForm<TInput, unknown, TOutput>({ ...options, resolver: zodResolver(schema) });
  const { setError } = form;
  const applyServerErrors = useCallback(
    (error: unknown, renames?: Record<string, string>) =>
      applyApiErrors<TInput>(error, setError, renames),
    [setError],
  );
  return { ...form, applyServerErrors };
}
