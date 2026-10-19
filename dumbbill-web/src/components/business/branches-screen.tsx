'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
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
import { ApiError, businessApi, getBrowserApiClient } from '@/lib/api';
import type { Branch } from '@/lib/api/schemas/business';
import { useCan } from '@/lib/auth/use-can';
import { describeFailure, type FailureView } from './business-errors';

/**
 * The branches list: every branch the person may use, how many the plan allows, and (for people who can manage
 * settings) buttons to add, edit, and switch branches off and on.
 *
 * At the plan limit "Add a branch" is replaced by a plain explanation, because the server would refuse it anyway
 * (`PLAN_LIMIT_REACHED`); the server still enforces the limit, this only saves a pointless click.
 * Switching a branch off asks for confirmation in a dialog, because nobody can bill from it afterwards.
 */
export function BranchesScreen() {
  const t = useTranslations('Branches');
  const canManage = useCan('settings.manage');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [switchingOff, setSwitchingOff] = useState<Branch | null>(null);
  const [failure, setFailure] = useState<FailureView | null>(null);

  const list = useQuery({
    queryKey: ['branches', 'list'],
    queryFn: () => businessApi.listBranches(getBrowserApiClient()),
  });

  const change = useMutation({
    mutationFn: ({ branch, on }: { branch: Branch; on: boolean }) =>
      on
        ? businessApi.activateBranch(getBrowserApiClient(), branch.id)
        : businessApi.deactivateBranch(getBrowserApiClient(), branch.id),
    onSuccess: async (_saved, { on }) => {
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast({ title: on ? t('toast.on') : t('toast.off'), tone: 'success' });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'BUSINESS_RULE_VIOLATION') {
        setFailure({ title: t('errors.title'), body: t('errors.lastActive') });
      } else if (error instanceof ApiError && error.code === 'PLAN_LIMIT_REACHED') {
        setFailure({ title: t('limit.title'), body: error.detail ?? '' });
      } else {
        setFailure(
          describeFailure(error, {
            title: t('errors.title'),
            network: t('errors.network'),
            forbidden: t('errors.forbidden'),
            generic: t('errors.generic'),
          }),
        );
      }
    },
  });

  if (list.isError) {
    return (
      <Alert tone="danger" title={t('loadFailed')}>
        <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
          {t('errors.title')}
        </Button>
      </Alert>
    );
  }

  const atLimit = list.data ? list.data.limit.used >= list.data.limit.max : false;

  const columns: DataColumn<Branch>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      value: (branch) => branch.name,
      sortable: true,
      cell: (branch) => (
        <span className="flex flex-col">
          <span className="font-medium">{branch.name}</span>
          {branch.city && <span className="text-caption text-muted">{branch.city}</span>}
        </span>
      ),
    },
    {
      id: 'prefix',
      header: t('columns.prefix'),
      value: (branch) => branch.invoicePrefix,
      mono: true,
    },
    { id: 'state', header: t('columns.state'), value: (branch) => branch.stateName ?? '' },
    {
      id: 'paper',
      header: t('columns.paper'),
      value: (branch) => branch.printerWidthMm,
      mono: true,
      cell: (branch) => t('paperValue', { mm: branch.printerWidthMm }),
    },
    {
      id: 'status',
      header: t('columns.status'),
      value: (branch) => (branch.isActive ? 1 : 0),
      cell: (branch) => (
        <Badge variant={branch.isActive ? 'success' : 'neutral'}>
          {branch.isActive ? t('status.active') : t('status.off')}
        </Badge>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            align: 'right' as const,
            value: () => null,
            cell: (branch: Branch) => (
              <span className="flex justify-end gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link
                    href={`/branches/${branch.id}`}
                    aria-label={t('editLabel', { name: branch.name })}
                  >
                    {t('edit')}
                  </Link>
                </Button>
                {branch.isActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('switchOffLabel', { name: branch.name })}
                    onClick={() => setSwitchingOff(branch)}
                  >
                    {t('switchOff')}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('switchOnLabel', { name: branch.name })}
                    loading={change.isPending}
                    onClick={() => {
                      setFailure(null);
                      change.mutate({ branch, on: true });
                    }}
                  >
                    {t('switchOn')}
                  </Button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {list.data && (
          <p className="text-small text-muted">
            {t('usage', { used: list.data.limit.used, max: list.data.limit.max })}
          </p>
        )}
        {canManage && !atLimit && (
          <Button asChild variant="primary">
            <Link href="/branches/new">{t('add')}</Link>
          </Button>
        )}
      </div>

      {canManage && atLimit && list.data && (
        <Alert tone="warning" title={t('limit.title')}>
          {t('limit.body', { max: list.data.limit.max })}
          <span className="mt-2 block">
            <Button variant="secondary" size="sm" disabled>
              {t('limit.upgrade')}
            </Button>
          </span>
        </Alert>
      )}
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
          {failure.reference && (
            <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
          )}
        </Alert>
      )}

      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={list.data?.branches ?? []}
        getRowId={(branch) => branch.id}
        loading={list.isPending}
        empty={<EmptyState title={t('empty.title')} description={t('empty.body')} />}
        density="comfortable"
      />

      <Dialog
        open={switchingOff !== null}
        onOpenChange={(open) => !open && setSwitchingOff(null)}
        title={t('confirmOff.title', { name: switchingOff?.name ?? '' })}
        description={t('confirmOff.body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSwitchingOff(null)}>
              {t('confirmOff.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={change.isPending}
              onClick={() => {
                if (!switchingOff) return;
                setFailure(null);
                change.mutate({ branch: switchingOff, on: false });
                setSwitchingOff(null);
              }}
            >
              {t('confirmOff.confirm')}
            </Button>
          </>
        }
      />
    </div>
  );
}
