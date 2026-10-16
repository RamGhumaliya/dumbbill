'use client';

import { Select as RadixSelect } from 'radix-ui';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';
import { CheckIcon, ChevronDownIcon } from './icons';

/**
 * A dropdown list (single choice).
 *
 * Built on Radix Select, which provides the hard parts correctly: full keyboard use (arrows, Home/End,
 * type-ahead letters, Enter, Escape), screen-reader roles, focus handling and form submission.
 * We only add the look. Inside a <Field> it is labelled and its error state wired automatically.
 *
 *   <Select options={[{ value: 'whey', label: 'Whey protein' }]} value={v} onValueChange={setV}
 *           placeholder="Choose a category" />
 *
 * Option values must be non-empty strings (a Radix rule: an empty value means "nothing selected").
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** Needed when the Select is not inside a <Field> (screen readers need a name). */
  'aria-label'?: string;
  /** Name used when the surrounding <form> is submitted. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  name,
  disabled,
  className,
  'aria-label': ariaLabel,
}: SelectProps) {
  const field = useFieldControl();

  return (
    <RadixSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      name={name}
      disabled={disabled}
      required={field.required}
    >
      <RadixSelect.Trigger
        id={field.id}
        aria-label={ariaLabel}
        aria-describedby={field['aria-describedby']}
        aria-invalid={field['aria-invalid']}
        className={cn(
          'flex min-h-(--size-control-md) w-full items-center justify-between gap-2 rounded-control border border-control bg-surface px-3 text-left text-small text-ink',
          'hover:border-ink data-placeholder:text-muted',
          'transition-colors duration-(--duration-micro) ease-enter',
          'aria-invalid:border-2 aria-invalid:border-danger',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDownIcon className="size-4 text-muted" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden',
            'rounded-card border border-control bg-surface text-ink',
            'data-[state=closed]:animate-rise-out data-[state=open]:animate-rise-in',
          )}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex min-h-(--size-control-sm) cursor-default items-center rounded-control py-1.5 pr-3 pl-8 text-small select-none',
                  'data-highlighted:bg-hover data-highlighted:outline-hidden',
                  'data-disabled:pointer-events-none data-disabled:opacity-50',
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex">
                  <CheckIcon className="size-4" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
