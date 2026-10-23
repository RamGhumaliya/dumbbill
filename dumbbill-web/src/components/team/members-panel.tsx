'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  useToast,
  type DataColumn,
} from '@/components/ui';
import { getBrowserApiClient, teamApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format/datetime';
import type { Member, MemberStatus, TeamOptions } from '@/lib/api/schemas/team';
import { useSession } from '@/stores/session';
import type { FailureView } from '../business/business-errors';
import { MemberDialog } from './member-dialog';
import { describeTeamFailure } from './team-errors';

const STATUS_BADGE: Record<MemberStatus, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  DISABLED: 'neutral',
};

/**
 * The People tab: everyone in the business, with their role, branches and status, and the things an owner does with
 * them: invite, edit, switch off and on, and send an invitation again.
 *
 * The owner and the signed-in person themselves have no action buttons: the server refuses both (nobody edits the
 * owner, nobody changes their own role or switches themselves off), so the screen simply does not offer them.
 * Switching someone off asks first, because it signs them out at once.
 */
export function MembersPanel({ members, options }: { members: Member[]; options: TeamOptions }) {
  const t = useTranslations('Team');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const me = useSession((state) => state.user?.id);
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [confirmOff, setConfirmOff] = useState<Member | null>(null);
  const [failure, setFailure] = useState<FailureView | null>(null);

  const messages = {
    title: t('errors.title'),
    network: t('errors.network'),
    forbidden: t('errors.forbidden'),
    generic: t('errors.generic'),
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team'] });

  const run = useMutation({
    mutationFn: async (job: { kind: 'off' | 'on' | 'resend'; member: Member }) => {
      const client = getBrowserApiClient();
      if (job.kind === 'off') return teamApi.disableMember(client, job.member.id);
      if (job.kind === 'on') return teamApi.enableMember(client, job.member.id);
      return teamApi.resendInvitation(client, job.member.id);
    },
    onSuccess: async (_result, { kind, member }) => {
      await refresh();
      const key = kind === 'off' ? 'off' : kind === 'on' ? 'on' : 'resent';
      toast({ title: t(`people.toast.${key}`, { name: member.fullName }), tone: 'success' });
    },
    onError: (error) => setFailure(describeTeamFailure(error, messages)),
  });

  const branchText = (member: Member): string => {
    if (member.effective.allBranches) return t('people.allBranches');
    const names = options.branches
      .filter((branch) => member.branchIds.includes(branch.id))
      .map((branch) => branch.name);
    return names.length > 0 ? names.join(', ') : t('people.noBranches');
  };

  const columns: DataColumn<Member>[] = [
    {
      id: 'name',
      header: t('people.columns.name'),
      value: (member) => member.fullName,
      sortable: true,
      cell: (member) => (
        <span className="flex flex-col">
          <span className="font-medium">
            {member.fullName}
            {member.id === me && (
              <span className="ml-2 text-caption text-muted">{t('people.you')}</span>
            )}
          </span>
          <span className="text-caption text-muted">{member.email}</span>
        </span>
      ),
    },
    {
      id: 'role',
      header: t('people.columns.role'),
      value: (member) => member.role?.name ?? '',
      sortable: true,
      cell: (member) => (member.isOwner ? t('people.owner') : (member.role?.name ?? '')),
    },
    {
      id: 'branches',
      header: t('people.columns.branches'),
      value: (member) => branchText(member),
    },
    {
      id: 'status',
      header: t('people.columns.status'),
      value: (member) => member.status,
      cell: (member) => (
        <Badge variant={STATUS_BADGE[member.status]}>{t(`people.status.${member.status}`)}</Badge>
      ),
    },
    {
      id: 'lastSignIn',
      header: t('people.columns.lastSignIn'),
      value: (member) => member.lastLoginAt ?? '',
      sortable: true,
      cell: (member) =>
        member.lastLoginAt ? formatDateTime(member.lastLoginAt) : t('people.neverSignedIn'),
    },
    {
      id: 'actions',
      header: t('people.columns.actions'),
      align: 'right',
      value: () => null,
      cell: (member) =>
        member.isOwner || member.id === me ? null : (
          <span className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('people.editLabel', { name: member.fullName })}
              onClick={() => setEditing(member)}
            >
              {t('people.edit')}
            </Button>
            {member.status === 'INVITED' && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('people.resendLabel', { name: member.fullName })}
                onClick={() => {
                  setFailure(null);
                  run.mutate({ kind: 'resend', member });
                }}
              >
                {t('people.resend')}
              </Button>
            )}
            {member.status === 'DISABLED' ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('people.switchOnLabel', { name: member.fullName })}
                onClick={() => {
                  setFailure(null);
                  run.mutate({ kind: 'on', member });
                }}
              >
                {t('people.switchOn')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('people.switchOffLabel', { name: member.fullName })}
                onClick={() => setConfirmOff(member)}
              >
                {t('people.switchOff')}
              </Button>
            )}
          </span>
        ),
    },
  ];

  const full = options.seats.used >= options.seats.max;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-muted">
          {t('seats', { used: options.seats.used, max: options.seats.max })}
        </p>
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('people.invite')}
        </Button>
      </div>
      {full && (
        <Alert tone="warning" title={t('seatsFullTitle')}>
          {t('seatsFull')}
        </Alert>
      )}
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
        </Alert>
      )}
      <DataTable
        caption={t('people.caption')}
        columns={columns}
        rows={members}
        getRowId={(member) => member.id}
        density="comfortable"
        empty={<EmptyState title={t('people.empty.title')} description={t('people.empty.body')} />}
      />
      {editing && (
        <MemberDialog
          member={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmOff && (
        <Dialog
          open
          onOpenChange={(open) => !open && setConfirmOff(null)}
          title={t('people.confirmOff.title', { name: confirmOff.fullName })}
          description={t('people.confirmOff.body')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmOff(null)}>
                {t('people.confirmOff.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setFailure(null);
                  run.mutate({ kind: 'off', member: confirmOff });
                  setConfirmOff(null);
                }}
              >
                {t('people.confirmOff.confirm')}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
