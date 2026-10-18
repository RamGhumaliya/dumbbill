'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Skeleton, useToast } from '@/components/ui';
import { authApi, getBrowserApiClient } from '@/lib/api';
import type { Session } from '@/lib/api/schemas/auth';
import { formatDateTime } from '@/lib/format/datetime';
import { describeApiError } from '../auth-errors';

/** The cache key of the device list, shared so signing a device out refreshes exactly this list. */
const SESSIONS_KEY = ['auth', 'sessions'] as const;

/**
 * "Which devices are signed in to my account?" with a Sign out button on each.
 *
 * Why it matters: a stranger's session (a stolen phone, a forgotten shop computer) is the thing an owner most wants
 * to be able to end. Each row shows a recognisable name ("Chrome on Windows"), when it was last used and where it
 * signed in from; the device you are using now is marked and cannot be signed out from here (use Sign out in the menu).
 * Ending a device takes effect immediately on the server.
 */
export function DevicesList() {
  const t = useTranslations('Auth');
  const common = useTranslations('Common');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: ({ signal }) => authApi.listSessions(getBrowserApiClient(), signal),
    select: (data) => data.sessions,
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) => authApi.revokeSession(getBrowserApiClient(), sessionId),
    onSuccess: async () => {
      toast({ title: t('security.devices.signedOut'), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
    onError: (error) => {
      const view = describeApiError(error, t);
      toast({ title: view.title, description: view.body, tone: 'danger' });
    },
  });

  if (sessions.isPending) {
    return (
      <div role="status" aria-label={t('security.devices.loading')} className="flex flex-col gap-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (sessions.isError) {
    return (
      <Alert tone="danger" title={t('security.devices.failed')}>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => sessions.refetch()}>
          {common('tryAgain')}
        </Button>
      </Alert>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {sessions.data.map((session) => (
        <DeviceRow
          key={session.id}
          session={session}
          busy={revoke.isPending && revoke.variables === session.id}
          onSignOut={() => revoke.mutate(session.id)}
        />
      ))}
    </ul>
  );
}

/** One signed-in device. */
function DeviceRow({
  session,
  busy,
  onSignOut,
}: {
  session: Session;
  busy: boolean;
  onSignOut: () => void;
}) {
  const t = useTranslations('Auth');
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {session.deviceLabel}
          {session.current && <Badge variant="accent">{t('security.devices.current')}</Badge>}
        </p>
        <p className="text-caption text-muted">
          {t('security.devices.lastUsed', { when: formatDateTime(session.lastUsedAt) })}
          {session.ipAddress && <span className="font-mono"> · {session.ipAddress}</span>}
        </p>
        <p className="text-caption text-muted">
          {t('security.devices.signedInSince', { when: formatDateTime(session.createdAt) })}
          {' · '}
          {session.clientType === 'WEB' ? t('security.devices.web') : t('security.devices.mobile')}
        </p>
      </div>
      {!session.current && (
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          aria-label={t('security.devices.signOutLabel', { device: session.deviceLabel })}
          onClick={onSignOut}
        >
          {t('security.devices.signOut')}
        </Button>
      )}
    </li>
  );
}
