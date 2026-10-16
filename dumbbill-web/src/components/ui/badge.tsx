import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * A small label for a status or category: "In stock", "Expires in 12 days", "Draft".
 *
 * Meaning is ALWAYS in the words, never in the colour alone (colour-blind users and printed receipts
 * must still understand it). Variants:
 *   neutral  plain information
 *   accent   highlighted / new / selected
 *   success  positive status
 *   danger   problem or blocked
 *   warning  needs attention soon (expiry, low stock). Uses the tag colours.
 */
const badgeStyles = cva(
  'inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-micro font-medium tracking-wide whitespace-nowrap uppercase',
  {
    variants: {
      variant: {
        neutral: 'border border-line text-muted',
        accent: 'bg-accent text-on-accent',
        success: 'border border-success text-success',
        danger: 'border border-danger text-danger',
        warning: 'bg-tag text-on-tag',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeStyles>;

export function Badge({ variant, className, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ variant }), className)} {...props} />;
}
