import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/format/money';

/**
 * An amount of money. THE way to show a price or total anywhere in the product.
 *
 * It takes whole PAISE (an integer, exactly as the API sends it) and shows Indian grouping:
 * 12450000 -> "₹1,24,500.00". Numbers use tabular figures so columns of prices line up, and right-aligned
 * columns look right.
 *
 * Sizes:
 *   inline  prices inside text and tables (monospaced, aligns digits)
 *   total   a bill total or KPI (condensed display font)
 *   hero    the one huge number at the till
 *
 * Negative amounts (refunds, discounts) show a minus sign AND the danger colour: never colour alone.
 * `trimZeroPaise` drops ".00" for whole-rupee totals; real paise are never hidden.
 */
const moneyStyles = cva('whitespace-nowrap tabular-nums', {
  variants: {
    size: {
      inline: 'font-mono text-small',
      total: 'font-display text-heading font-semibold',
      hero: 'font-display text-hero leading-none font-bold',
    },
    tone: {
      default: '',
      muted: 'text-muted',
    },
  },
  defaultVariants: { size: 'inline', tone: 'default' },
});

export interface MoneyTextProps extends VariantProps<typeof moneyStyles> {
  /** Amount in whole paise. */
  paise: number;
  /** Show "₹6,694" instead of "₹6,694.00" when there are no paise. */
  trimZeroPaise?: boolean;
  className?: string;
}

export function MoneyText({ paise, size, tone, trimZeroPaise, className }: MoneyTextProps) {
  const negative = paise < 0;
  return (
    <span
      // The exact amount, for tests and for tools that read the page.
      data-paise={paise}
      className={cn(moneyStyles({ size, tone }), negative && 'text-danger', className)}
    >
      {formatPaise(paise, { trimZeroPaise })}
    </span>
  );
}
