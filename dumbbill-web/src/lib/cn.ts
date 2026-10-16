import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { COLOR_NAMES, FONT_SIZE_NAMES, RADIUS_NAMES } from './design/token-names';

/**
 * Joins class names and resolves conflicts: `cn('px-3', condition && 'px-5', className)` keeps only the
 * last padding. Components use it so a caller can override a style by passing `className`.
 *
 * tailwind-merge has to be told about our own class names. Without this it cannot tell that
 * `text-micro` is a font SIZE and `text-muted` is a COLOUR, and it would drop one of them when both are
 * used on the same element. The names come from the generated design tokens, so they never drift.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      color: [...COLOR_NAMES],
      text: [...FONT_SIZE_NAMES],
      radius: [...RADIUS_NAMES],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
