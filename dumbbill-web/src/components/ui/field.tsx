'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A form field: label, the control, an optional hint and an optional error message, all connected for
 * assistive technology (the label is tied to the control; hint and error are announced with it).
 *
 *   <Field label="Product name" hint="As printed on the pack" error={errors.name?.message} required>
 *     <Input {...register('name')} />
 *   </Field>
 *
 * Controls placed inside (Input, Select) read their id and aria attributes from here, so nobody has to
 * wire ids by hand. Errors say what is wrong and how to fix it, in plain words, and never rely on colour alone.
 */
interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a control should spread onto its form element, taken from the surrounding Field (if any). */
export function useFieldControl(): {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: true;
} {
  const field = useContext(FieldContext);
  if (!field) return {};
  return {
    id: field.id,
    'aria-describedby': field.describedBy,
    'aria-invalid': field.invalid || undefined,
    required: field.required || undefined,
  };
}

export interface FieldProps {
  label: string;
  /** Extra help shown under the control. */
  hint?: string;
  /** What is wrong. When present the field is marked invalid. */
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required = false, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={id} className="text-small font-medium">
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-danger">
              *
            </span>
          )}
        </label>
        {children}
        {hint && (
          <p id={hintId} className="text-caption text-muted">
            {hint}
          </p>
        )}
        {error && (
          // role="alert" makes screen readers announce the message the moment it appears.
          <p id={errorId} role="alert" className="text-caption font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
