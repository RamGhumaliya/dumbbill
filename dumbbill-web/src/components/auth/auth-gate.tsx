'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { restoreSession } from '@/lib/auth/session-actions';
import { useSession } from '@/stores/session';

/**
 * Wraps every screen that needs a signed-in person (the owner area, the till, the admin area).
 *
 * What it does:
 *  1. On load it asks whether a login exists (renews the access token with the refresh cookie).
 *  2. While that runs it shows a short "checking your sign-in" line, NOT the screen: no flash of content.
 *  3. If there is no login it sends the person to `/login?next=<this page>` so they come back here afterwards.
 *  4. If the login ends while the person is working (the API refuses a renewal), step 3 happens again.
 *
 * IMPORTANT: this decides what the SCREEN shows; it is not what protects the data. The API refuses every call that
 * lacks a valid token. Because the access token lives only in browser memory, the server cannot know who is asking
 * when it renders a page, so these screens must load their data in the browser, never in a Server Component.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations('Auth');
  const status = useSession((state) => state.status);
  const choseToSignOut = useSession((state) => state.choseToSignOut);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'restoring') void restoreSession();
  }, [status]);

  useEffect(() => {
    if (status !== 'signedOut') return;
    // A person who just chose to sign out is not coming back to this page; anyone else returns to it after signing in.
    router.replace(
      choseToSignOut ? '/login?notice=signed-out' : `/login?next=${encodeURIComponent(pathname)}`,
    );
  }, [status, choseToSignOut, router, pathname]);

  if (status !== 'signedIn') {
    return (
      <p role="status" className="px-4 py-8 text-body text-muted sm:px-6">
        {t('gate.checking')}
      </p>
    );
  }
  return <>{children}</>;
}
