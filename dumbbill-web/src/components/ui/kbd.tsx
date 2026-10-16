import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Shows a keyboard key, for shortcut hints: <Kbd>F9</Kbd>.
 * The POS is keyboard-first, so the shortcuts are written on the buttons they trigger.
 *
 * Inside a PRIMARY (accent-coloured) button use `onAccent`: the key is then drawn as an outline in the
 * button's own text colour instead of a surface-coloured box, so it stays readable in both themes.
 */
export function Kbd({
  onAccent = false,
  className,
  ...props
}: ComponentProps<'kbd'> & { onAccent?: boolean }) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded-control border px-1.5 py-0.5 font-mono text-micro font-medium',
        onAccent
          ? 'border-on-accent bg-transparent text-on-accent'
          : 'border-line bg-surface text-muted',
        className,
      )}
      {...props}
    />
  );
}
