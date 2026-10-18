import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Loader2,
  Minus,
  PackageOpen,
  X,
} from 'lucide-react';
import type { ComponentProps } from 'react';

/**
 * The icons the design system uses. One set (Lucide), one stroke weight, one size, so icons always
 * look like a family (design guide: 1.5 px stroke on a 20 px grid, never emoji).
 *
 * Import icons from HERE, not from `lucide-react` directly, so the look stays consistent and the set
 * can be swapped in one place.
 *
 * Icons are decorative: the text or accessible name next to them carries the meaning, so they are hidden
 * from screen readers (aria-hidden).
 */
type LucideIcon = typeof Check;

/** Wraps a Lucide icon with our defaults: 20 px (size-5), 1.5 stroke, hidden from assistive technology. */
function withDefaults(Icon: LucideIcon): (props: ComponentProps<LucideIcon>) => React.JSX.Element {
  function DesignSystemIcon({ className, ...props }: ComponentProps<LucideIcon>) {
    return <Icon aria-hidden strokeWidth={1.5} className={className ?? 'size-5'} {...props} />;
  }
  DesignSystemIcon.displayName = `Icon(${Icon.displayName ?? 'icon'})`;
  return DesignSystemIcon;
}

export const CheckIcon = withDefaults(Check);
export const ChevronDownIcon = withDefaults(ChevronDown);
export const ChevronUpIcon = withDefaults(ChevronUp);
export const ChevronsUpDownIcon = withDefaults(ChevronsUpDown);
export const MinusIcon = withDefaults(Minus);
export const CloseIcon = withDefaults(X);
export const EmptyBoxIcon = withDefaults(PackageOpen);
export const EyeIcon = withDefaults(Eye);
export const EyeOffIcon = withDefaults(EyeOff);
/** A spinning indicator. The spin stops for people who prefer reduced motion (see globals.css). */
export const SpinnerIcon = withDefaults(Loader2);
