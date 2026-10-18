'use client';

import { useState, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { EyeIcon, EyeOffIcon } from './icons';
import { Input } from './input';

/**
 * A password box with a "Show" button, so a person typing a long passphrase on a phone or a shared till can
 * check it. Long passphrases are what we ask for, and typing one blind is how mistakes happen.
 *
 *   <Field label="Password"><PasswordInput autoComplete="current-password" {...register('password')} /></Field>
 *
 * Inside a <Field> it is labelled automatically (it is an Input). The button is part of the tab order, has its
 * own name ("Show password" / "Hide password", passed in so it can be translated) and announces its state with
 * `aria-pressed`. The password is hidden again whenever the page is left, because it is plain component state.
 */
export type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'> & {
  /** Accessible name of the button while the password is hidden, for example "Show password". */
  showLabel: string;
  /** Accessible name of the button while the password is visible, for example "Hide password". */
  hideLabel: string;
};

export function PasswordInput({ showLabel, hideLabel, className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-11', className)} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-pressed={visible}
        aria-label={visible ? hideLabel : showLabel}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-muted hover:text-ink"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
