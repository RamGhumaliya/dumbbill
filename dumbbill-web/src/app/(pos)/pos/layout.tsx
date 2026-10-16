import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * Frame for the point of sale. The till is used all day by cashiers, so it has no sidebar and no extra
 * navigation: the full screen belongs to the bill. (Browser USB/serial access for printers and
 * scanners is allowed only on this path; see src/lib/security/csp.ts.)
 */
export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
