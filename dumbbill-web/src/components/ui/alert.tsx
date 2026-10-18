import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A message that stays on the screen where the person is looking: "The email or password is not correct",
 * "Check your inbox". Use it for the outcome of a form or a state of the page. For a passing confirmation
 * ("Saved") use a Toast instead; for something that must be answered before going on, use a Dialog.
 *
 *   <Alert tone="danger" title="Cannot sign in">The email or password is not correct.</Alert>
 *
 * Design: flat and calm. A thin card with a coloured edge on the left and a bold title. The meaning is always
 * in the words (the title), never carried by the edge colour alone.
 *
 * Accessibility: `danger` and `warning` are announced at once by screen readers (role "alert"); `info` and
 * `success` are announced politely (role "status"). Put the title first so the announcement starts with the point.
 */
const alertStyles = cva(
  'flex flex-col gap-1 rounded-control border border-line border-l-4 bg-surface px-4 py-3 text-small',
  {
    variants: {
      tone: {
        info: 'border-l-accent',
        success: 'border-l-success',
        warning: 'border-l-tag',
        danger: 'border-l-danger',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

export type AlertProps = Omit<ComponentProps<'div'>, 'title'> &
  VariantProps<typeof alertStyles> & {
    /** The point of the message, in a few words. */
    title: string;
    /** Details and what to do next. */
    children?: ReactNode;
  };

export function Alert({ tone, title, children, className, ...props }: AlertProps) {
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn(alertStyles({ tone }), className)}
      {...props}
    >
      <p className="font-medium">{title}</p>
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}
