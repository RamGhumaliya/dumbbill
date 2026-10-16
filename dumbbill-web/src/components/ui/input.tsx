'use client';

import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

/**
 * A single-line text box.
 *
 * Inside a <Field> it is labelled and its error state is wired automatically. On its own it still needs
 * an accessible name (pass `aria-label`, or use a <label htmlFor>).
 * States: default, hover, keyboard focus (global ring), filled, invalid (red edge, set by Field's `error`), disabled, read-only.
 * The edge uses the `control` colour, which is guaranteed 3:1 against the background (WCAG 1.4.11).
 * Heights come from the size tokens; text is at least 14 px so mobile browsers do not zoom on focus.
 */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  const field = useFieldControl();
  return (
    <input
      {...field}
      {...props}
      className={cn(
        'min-h-(--size-control-md) w-full rounded-control border border-control bg-surface px-3 text-small text-ink',
        'placeholder:text-muted hover:border-ink',
        'transition-colors duration-(--duration-micro) ease-enter',
        'aria-invalid:border-2 aria-invalid:border-danger',
        'read-only:bg-side disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    />
  );
}
