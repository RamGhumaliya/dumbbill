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
import type { Role, TeamOptions } from '@/lib/api/schemas/team';
import type { FailureView } from '../business/business-errors';
import { RoleDialog } from './role-dialog';
import { describeTeamFailure } from './team-errors';
import { bpToPercentText } from './team-helpers';

/**
 * The Roles tab: the built-in Owner, Admin and Cashier roles and the ones the business made. The Owner role is shown but
 * never editable (it always holds every ability). Built-in Admin and Cashier can be edited but not renamed or deleted.
 * A role people still have cannot be deleted; the server says how many, and that sentence is shown.
 */
export function RolesPanel({ options }: { options: TeamOptions }) {
  const t = useTranslations('Team');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);
  const [failure, setFailure] = useState<FailureView | null>(null);

  const remove = useMutation({
    mutationFn: (role: Role) => teamApi.deleteRole(getBrowserApiClient(), role.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      toast({ title: t('roles.toast.deleted'), tone: 'success' });
    },
    onError: (error) =>
      setFailure(
        describeTeamFailure(error, {
          title: t('errors.title'),
          network: t('errors.network'),
          forbidden: t('errors.forbidden'),
          generic: t('errors.generic'),
        }),
      ),
  });

  const columns: DataColumn<Role>[] = [
    {
      id: 'name',
      header: t('roles.columns.name'),
      value: (role) => role.name,
      sortable: true,
      cell: (role) => (
        <span className="flex flex-col">
          <span className="font-medium">
            {role.name}
            {role.systemKey && (
              <Badge variant="neutral" className="ml-2">
                {t('roles.builtIn')}
              </Badge>
            )}
          </span>
          <span className="text-caption text-muted">{role.description}</span>
        </span>
      ),
    },
    {
      id: 'people',
      header: t('roles.columns.people'),
      value: (role) => role.memberCount,
      align: 'right',
      sortable: true,
    },
    {
      id: 'abilities',
      header: t('roles.columns.abilities'),
      value: (role) => (role.locked ? 999 : role.permissions.length),
      cell: (role) =>
        role.locked
          ? t('roles.everything')
          : t('roles.abilityCount', { count: role.permissions.length }),
    },
    {
      id: 'discount',
      header: t('roles.columns.discount'),
      value: (role) => role.discountLimitBp,
      align: 'right',
      cell: (role) => `${bpToPercentText(role.discountLimitBp)}%`,
    },
    {
      id: 'branches',
      header: t('roles.columns.branches'),
      value: (role) => (role.allBranches ? 1 : 0),
      cell: (role) => (role.allBranches ? t('roles.allBranches') : t('roles.assignedOnly')),
    },
    {
      id: 'actions',
      header: t('roles.columns.actions'),
      align: 'right',
      value: () => null,
      cell: (role) =>
        role.locked ? null : (
          <span className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('roles.editLabel', { name: role.name })}
              onClick={() => setEditing(role)}
            >
              {t('roles.edit')}
            </Button>
            {!role.systemKey && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('roles.deleteLabel', { name: role.name })}
                onClick={() => setConfirmDelete(role)}
              >
                {t('roles.delete')}
              </Button>
            )}
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-muted">{t('roles.ownerNote')}</p>
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('roles.add')}
        </Button>
      </div>
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
        </Alert>
      )}
      <DataTable
        caption={t('roles.caption')}
        columns={columns}
        rows={options.roles}
        getRowId={(role) => role.id}
        density="comfortable"
        empty={<EmptyState title={t('roles.caption')} />}
      />
      {editing && (
        <RoleDialog
          role={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmDelete && (
        <Dialog
          open
          onOpenChange={(open) => !open && setConfirmDelete(null)}
          title={t('roles.confirmDelete.title', { name: confirmDelete.name })}
          description={t('roles.confirmDelete.body')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                {t('roles.confirmDelete.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setFailure(null);
                  remove.mutate(confirmDelete);
                  setConfirmDelete(null);
                }}
              >
                {t('roles.confirmDelete.confirm')}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
