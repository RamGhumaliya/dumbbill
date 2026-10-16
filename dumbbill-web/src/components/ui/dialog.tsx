'use client';

import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './button';
import { CloseIcon } from './icons';

/**
 * A dialog (modal window): something that needs the user's full attention before they continue,
 * such as confirming a refund. Use sparingly.
 *
 * Built on Radix Dialog, which handles the accessibility that is easy to get wrong:
 *   - focus moves into the dialog when it opens, stays trapped inside while it is open,
 *     and returns to the button that opened it when it closes
 *   - Escape closes it; the page behind cannot be reached by keyboard or screen reader
 *   - it is announced with its title and description
 *
 * A `title` is REQUIRED (it is the dialog's accessible name). Put the buttons in `footer`, with the
 * main action last. Control it with `open` / `onOpenChange`, or pass a `trigger` for the simple case.
 */
export interface DialogProps {
  title: string;
  /** One sentence saying what happens. Read out by screen readers right after the title. */
  description?: string;
  children?: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  /** The element that opens the dialog (usually a Button). Omit it when controlling `open` yourself. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Dialog({
  title,
  description,
  children,
  footer,
  trigger,
  open,
  onOpenChange,
  className,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-overlay',
            'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
          )}
        />
        <RadixDialog.Content
          // With no description, say so explicitly (Radix would otherwise warn about a missing one). With one,
          // leave the prop alone so Radix links the description to the dialog.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-card border border-line bg-surface text-ink',
            'data-[state=closed]:animate-rise-out data-[state=open]:animate-rise-in',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="font-display text-title font-bold tracking-wide uppercase">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-small text-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <CloseIcon />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4 text-small">{children}</div>}
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Closes the dialog it is placed in. Wrap a Button: <DialogClose asChild><Button>Cancel</Button></DialogClose>. */
export const DialogClose = RadixDialog.Close;
