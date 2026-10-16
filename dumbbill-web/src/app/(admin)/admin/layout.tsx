import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * Frame for the Super Admin area (the platform owner's tools: retailers, plans, usage).
 * Deliberately plain and table-first. Access is restricted to platform staff once login exists (Phase 4).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </>
  );
}
