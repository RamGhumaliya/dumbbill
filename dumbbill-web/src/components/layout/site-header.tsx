import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { getThemeChoice } from '@/lib/theme-server';

/**
 * The bar across the top of every screen: product name on the left, optional navigation, and the theme
 * switch on the right. The three areas of the app (owner, POS, admin) all use it, each passing its own navigation.
 */
export async function SiteHeader({ children }: { children?: ReactNode }) {
  const t = await getTranslations('Brand');
  const theme = await getThemeChoice();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-base px-4 py-2 sm:px-6">
      <div className="flex items-center gap-6">
        <Link href="/" className="font-display text-title font-bold tracking-wider uppercase">
          {t('name')}
        </Link>
        {children}
      </div>
      <ThemeToggle initial={theme} />
    </header>
  );
}
