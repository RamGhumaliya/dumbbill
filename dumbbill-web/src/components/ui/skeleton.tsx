import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * A grey placeholder shown while real content loads. Preferred over a spinner because the page keeps its
 * shape (nothing jumps when the data arrives).
 *
 * It is hidden from screen readers (aria-hidden). Mark the CONTAINER being loaded with `aria-busy="true"`
 * and give it a text alternative where it matters, so people using assistive technology know to wait.
 * Give it a size with className (for example `h-4 w-32`). The pulse stops for reduced-motion users.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-skeleton rounded-control bg-line', className)}
      {...props}
    />
  );
}
