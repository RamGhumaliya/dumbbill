'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * A popover: a small panel anchored to a button, for quick choices that do not deserve a full dialog
 * (a discount entry at the till, a column picker). Unlike a dialog it does not block the page.
 *
 * Built on Radix Popover: Escape or a click outside closes it, focus moves in and back out, and the
 * trigger announces that it opens a panel.
 *
 *   <Popover>
 *     <PopoverTrigger asChild><Button>Discount</Button></PopoverTrigger>
 *     <PopoverContent>...</PopoverContent>
 *   </Popover>
 *
 * If the content contains a form control it needs its own accessible name (aria-label or a Field).
 */
export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-card border border-control bg-surface p-4 text-small text-ink',
          'data-[state=closed]:animate-rise-out data-[state=open]:animate-rise-in',
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
