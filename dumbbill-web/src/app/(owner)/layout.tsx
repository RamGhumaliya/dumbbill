import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { UserMenu } from '@/components/auth/user-menu';
import { SiteHeader } from '@/components/layout/site-header';
import { OwnerNav } from '@/components/owner/owner-nav';

/**
 * Frame for the owner/admin web app (the retailer's own screens: dashboard, products, reports ...).
 * Route groups such as "(owner)" organise code only; they do not appear in the web address.
 *
 * Everything inside is behind the sign-in gate: nothing below the header is shown until the browser has proved
 * there is a login (see AuthGate). The header itself is public chrome (product name, theme switch).
 * The navigation (OwnerNav) grows screen by screen; settings links show only to people who can manage settings.
 */
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader actions={<UserMenu />}>
        <OwnerNav />
      </SiteHeader>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <AuthGate>{children}</AuthGate>
      </main>
    </>
  );
}
