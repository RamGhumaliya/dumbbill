'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { endSession } from '@/lib/auth/session-actions';
import { useSession } from '@/stores/session';

/**
 * The person's name in the top bar, opening a small panel with who they are, a link to account security and
 * "Sign out". Shown only while someone is signed in (nothing on the sign-in pages).
 *
 * Signing out wipes everything held for this person (see endSession): on a shared shop computer, the next person
 * must not see the previous one's data or half-built bill. The AuthGate then sends the screen to /login.
 */
export function UserMenu() {
  const t = useTranslations('Auth');
  const queryClient = useQueryClient();
  const user = useSession((state) => state.user);
  const tenant = useSession((state) => state.tenant);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${t('user.menu')}: ${user.fullName}`}>
          <span className="max-w-40 truncate">{user.fullName}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-3">
        <div>
          <p className="font-medium">{t('user.signedInAs', { name: user.fullName })}</p>
          <p className="truncate text-caption text-muted">{user.email}</p>
          {tenant && <p className="truncate text-caption text-muted">{tenant.name}</p>}
        </div>
        <Link
          href="/account/security"
          className="text-ink underline underline-offset-4 hover:text-muted"
        >
          {t('user.security')}
        </Link>
        <Button
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await endSession(queryClient);
          }}
        >
          {busy ? t('user.signingOut') : t('user.signOut')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
