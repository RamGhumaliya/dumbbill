'use client';

import { Checkbox as RadixCheckbox } from 'radix-ui';
import { useId, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { CheckIcon, MinusIcon } from './icons';

/**
 * A tick box with its label. The whole label is clickable, which makes a comfortable target.
 *
 * Built on Radix Checkbox: Space toggles, state is announced, and it works inside forms.
 * `checked` can be true, false or "indeterminate" (a dash: "some, not all", used for select-all).
 * States: unchecked, checked, indeterminate, hover, keyboard focus (global ring), invalid, disabled.
 * The box edge uses the `control` colour (3:1 against the background).
 */
export interface CheckboxProps extends Omit<ComponentProps<typeof RadixCheckbox.Root>, 'children'> {
  /** The visible label. Required: a checkbox without a name means nothing to a screen reader. */
  label: string;
  /** Optional extra explanation shown under the label. */
  description?: string;
  invalid?: boolean;
}

export function Checkbox({
  label,
  description,
  invalid,
  className,
  id,
  disabled,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  const descriptionId = description ? `${checkboxId}-description` : undefined;

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <RadixCheckbox.Root
        id={checkboxId}
        disabled={disabled}
        aria-describedby={descriptionId}
        aria-invalid={invalid || undefined}
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-control border border-control bg-surface text-on-accent',
          'transition-colors duration-(--duration-micro) ease-enter hover:border-ink',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
          'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
          'aria-invalid:border-2 aria-invalid:border-danger',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      >
        <RadixCheckbox.Indicator>
          {props.checked === 'indeterminate' ? (
            <MinusIcon className="size-4" />
          ) : (
            <CheckIcon className="size-4" />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div className="flex flex-col">
        <label
          htmlFor={checkboxId}
          className={cn('text-small', disabled ? 'opacity-60' : 'cursor-pointer')}
        >
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-caption text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
