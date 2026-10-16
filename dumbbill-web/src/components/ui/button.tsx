import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { SpinnerIcon } from './icons';

/**
 * Buttons.
 *
 * Variants (what the button means):
 *   primary    the ONE main action on a screen (accent colour). Use at most once per area.
 *   secondary  any other action (outlined)
 *   danger     destructive actions: delete, cancel a bill
 *   ghost      low emphasis, for toolbars and icon buttons
 * Sizes: sm 32 px, md 40 px, lg 48 px (the POS uses lg: touch targets there must be at least 48 px).
 *
 * States, all handled here: default, hover, keyboard focus (global focus ring), pressed, disabled and loading.
 * While `loading`, the button is disabled and marked busy so it cannot be pressed twice. This matters for
 * anything that creates a bill or takes a payment.
 *
 * Colours come only from design tokens (see src/styles/tailwind-theme.css).
 */
export const buttonStyles = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none',
    'transition-colors duration-(--duration-micro) ease-enter active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-hover',
        secondary: 'border border-control bg-surface text-ink hover:bg-hover',
        danger: 'bg-danger text-on-danger hover:bg-danger-hover',
        ghost: 'text-ink hover:bg-hover',
      },
      size: {
        sm: 'min-h-(--size-control-sm) px-3 text-small',
        md: 'min-h-(--size-control-md) px-4 text-small',
        lg: 'min-h-(--size-control-lg) px-6 text-body',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonStyles> & {
    /** Show a spinner and block presses while something is being saved. */
    loading?: boolean;
    /** Render as the child element (for example a link that looks like a button) instead of a <button>. */
    asChild?: boolean;
  };

export function Button({
  variant,
  size,
  loading = false,
  asChild = false,
  className,
  children,
  disabled,
  type = 'button', // never submit a form by accident
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      type={asChild ? undefined : type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <SpinnerIcon className="size-4 animate-spin" />}
          {children}
        </>
      )}
    </Component>
  );
}

const iconButtonSizes = {
  sm: 'size-(--size-control-sm)',
  md: 'size-(--size-control-md)',
  lg: 'size-(--size-control-lg)',
} as const;

export type IconButtonProps = Omit<ButtonProps, 'children' | 'asChild' | 'aria-label'> & {
  /** What the button does, in words. REQUIRED: an icon alone means nothing to a screen reader. */
  label: string;
  children: React.ReactNode;
};

/**
 * A square button that shows only an icon. `label` becomes its accessible name (and a tooltip),
 * and is required so an unlabeled icon button cannot be written.
 */
export function IconButton({
  label,
  size = 'md',
  variant = 'ghost',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn('px-0', iconButtonSizes[size ?? 'md'], className)}
      {...props}
    >
      {children}
    </Button>
  );
}
