import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { UserMenu } from '@/components/auth/user-menu';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * Frame for the point of sale. The till is used all day by cashiers, so it has no sidebar and no extra
 * navigation: the full screen belongs to the bill. (Browser USB/serial access for printers and
 * scanners is allowed only on this path; see src/lib/security/csp.ts.)
 * Behind the sign-in gate like every other working screen.
 */
export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader actions={<UserMenu />} />
      <main id="main" className="flex flex-1 flex-col">
        <AuthGate>{children}</AuthGate>
      </main>
    </div>
  );
}
