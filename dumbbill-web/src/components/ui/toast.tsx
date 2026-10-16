'use client';

import { Toast as RadixToast } from 'radix-ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { CloseIcon } from './icons';

/**
 * Toasts: short messages that appear for a few seconds after something happened ("Bill saved").
 *
 * Use: put <ToastProvider> once near the root (done in src/app/layout.tsx), then anywhere:
 *
 *   const { toast } = useToast();
 *   toast({ title: 'Bill saved', description: 'Invoice DB-0042', tone: 'success' });
 *
 * Accessibility (via Radix Toast): messages are announced by screen readers without stealing focus.
 * `danger` toasts are announced immediately (assertive), others politely. The timer pauses while the
 * pointer or keyboard focus is on a toast, and a toast can be dismissed with its close button.
 * F8 moves keyboard focus to the toasts. Never use a toast for something the user MUST act on: use a dialog.
 *
 * Meaning is carried by the title text and a coloured edge, never by colour alone.
 */
export type ToastTone = 'neutral' | 'success' | 'danger';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** How long it stays, in milliseconds. Default 5000 (8000 for errors, which need more time to read). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ toast: (input: ToastInput) => void } | null>(null);

/** The function that shows a toast. Must be used under <ToastProvider>. */
export function useToast(): { toast: (input: ToastInput) => void } {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}

const toneEdge: Record<ToastTone, string> = {
  neutral: 'border-l-ink',
  success: 'border-l-success',
  danger: 'border-l-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  // --- Why the next lines exist (a real bug found by the browser tests) -------------------------------------
  // When the user dismisses a toast, Radix moves keyboard focus to its notification area and marks the area
  // "paused" (timers must not run while someone is interacting with it). With no toast left, nothing ever
  // clears that mark, so the NEXT toast would sit on screen forever. The cure is to give Radix a fresh start
  // whenever the last toast closes: a new `key` on its provider. A fresh start drops keyboard focus, so we
  // also hand focus back to the element the user was on before the toast appeared.
  const [generation, setGeneration] = useState(0);
  const hadToasts = useRef(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (items.length > 0) {
      hadToasts.current = true;
      return;
    }
    if (!hadToasts.current) return;
    hadToasts.current = false;
    setGeneration((value) => value + 1);
    const target = returnFocusTo.current;
    returnFocusTo.current = null;
    requestAnimationFrame(() => {
      // Only restore focus if it was lost; never pull it away from somewhere the user has moved on to.
      if (
        target?.isConnected &&
        (!document.activeElement || document.activeElement === document.body)
      ) {
        target.focus();
      }
    });
  }, [items.length]);

  const toast = useCallback((input: ToastInput) => {
    // Remember what had focus when a batch of toasts starts, so it can be given back at the end.
    if (!hadToasts.current && document.activeElement instanceof HTMLElement) {
      returnFocusTo.current = document.activeElement;
    }
    // A simple increasing id is enough: it only needs to be unique among toasts currently on screen.
    setItems((current) => [...current, { ...input, id: (current.at(-1)?.id ?? 0) + 1 }]);
  }, []);

  const remove = useCallback(
    (id: number) => setItems((current) => current.filter((item) => item.id !== id)),
    [],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <RadixToast.Provider key={generation} swipeDirection="right">
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            type={item.tone === 'danger' ? 'foreground' : 'background'}
            duration={item.durationMs ?? (item.tone === 'danger' ? 8000 : 5000)}
            onOpenChange={(open) => {
              if (!open) remove(item.id);
            }}
            className={cn(
              'grid grid-cols-[1fr_auto] items-start gap-x-3 rounded-card border border-l-4 border-line bg-surface p-4 text-ink',
              toneEdge[item.tone ?? 'neutral'],
              'data-[state=closed]:animate-toast-out data-[state=open]:animate-toast-in',
            )}
          >
            <RadixToast.Title className="text-small font-semibold">{item.title}</RadixToast.Title>
            <RadixToast.Close
              aria-label="Dismiss"
              className="-m-1 rounded-control p-1 text-muted hover:bg-hover hover:text-ink"
            >
              <CloseIcon className="size-4" />
            </RadixToast.Close>
            {item.description && (
              <RadixToast.Description className="col-span-2 mt-1 text-small text-muted">
                {item.description}
              </RadixToast.Description>
            )}
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport
          aria-label="Notifications"
          className="fixed right-0 bottom-0 z-50 m-0 flex w-full max-w-sm list-none flex-col gap-2 p-4 outline-hidden"
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
