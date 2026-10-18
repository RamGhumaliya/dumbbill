import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { UserMenu } from '@/components/auth/user-menu';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * Frame for the owner/admin web app (the retailer's own screens: dashboard, products, reports ...).
 * Route groups such as "(owner)" organise code only; they do not appear in the web address.
 *
 * Everything inside is behind the sign-in gate: nothing below the header is shown until the browser has proved
 * there is a login (see AuthGate). The header itself is public chrome (product name, theme switch).
 * Real navigation is added screen by screen from Phase 1.
 */
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('Nav');

  return (
    <>
      <SiteHeader actions={<UserMenu />}>
        <nav aria-label={t('main')} className="flex gap-4 text-small">
          <Link href="/" className="font-medium">
            {t('dashboard')}
          </Link>
          <Link href="/pos" className="text-muted hover:text-ink">
            {t('pos')}
          </Link>
        </nav>
      </SiteHeader>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <AuthGate>{children}</AuthGate>
      </main>
    </>
  );
}
