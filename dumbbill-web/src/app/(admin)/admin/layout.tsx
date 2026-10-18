import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { UserMenu } from '@/components/auth/user-menu';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * Frame for the Super Admin area (the platform owner's tools: retailers, plans, usage).
 * Deliberately plain and table-first. Behind the sign-in gate; restricting it to platform staff only
 * (a separate role, with mandatory two-step sign-in) arrives in Phase 4.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader actions={<UserMenu />} />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <AuthGate>{children}</AuthGate>
      </main>
    </>
  );
}
