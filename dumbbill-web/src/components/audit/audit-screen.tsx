'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  type DataColumn,
} from '@/components/ui';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { AuditEntry } from '@/lib/api/schemas/inventory';
import { formatDateTime } from '@/lib/format/datetime';

const PAGE_SIZE = 50;

/** A small before/after object as short text, for example "qty: 10". Plain values only; nothing here is a secret. */
function summarise(value: Record<string, unknown> | null): string {
  return value
    ? Object.entries(value)
        .map(([key, inner]) => `${key}: ${String(inner)}`)
        .join(', ')
    : '';
}

/**
 * The audit log viewer (US-AUD-01): who did what, when and from where, with the state before and after, filterable by
 * event, subject and time. Read-only. A button checks the tamper-evident chain over the log and says plainly whether it is
 * intact or where it first breaks. Needs `audit.read`.
 */
export function AuditScreen() {
  const t = useTranslations('Audit');
  const [filters, setFilters] = useState({ action: '', entity: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);

  const list = useQuery({
    queryKey: ['audit', 'list', applied, offset],
    queryFn: () =>
      inventoryApi.listAuditLog(getBrowserApiClient(), {
        action: applied.action || undefined,
        entity: applied.entity || undefined,
        // A "from" date starts at midnight and an "until" date ends at the end of that day (both in India).
        from: applied.from ? new Date(`${applied.from}T00:00:00+05:30`).toISOString() : undefined,
        to: applied.to ? new Date(`${applied.to}T23:59:59.999+05:30`).toISOString() : undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (previous) => previous,
  });
  const verify = useMutation({
    mutationFn: () => inventoryApi.verifyAuditLog(getBrowserApiClient()),
  });

  if (list.isError && !list.data) {
    const denied = list.error instanceof ApiError && list.error.code === 'FORBIDDEN';
    return (
      <Alert tone="danger" title={t('loadFailed')}>
        {!denied && (
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            {t('retry')}
          </Button>
        )}
      </Alert>
    );
  }

  const total = list.data?.total ?? 0;
  const columns: DataColumn<AuditEntry>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      value: (row) => row.createdAt,
      sortable: true,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      id: 'who',
      header: t('columns.who'),
      value: (row) => row.actorName ?? '',
      cell: (row) =>
        row.actorName
          ? row.actorRole
            ? t('roleAt', { name: row.actorName, role: row.actorRole })
            : row.actorName
          : t('system'),
    },
    { id: 'what', header: t('columns.what'), value: (row) => row.action, mono: true },
    { id: 'about', header: t('columns.about'), value: (row) => row.entity ?? '' },
    {
      id: 'details',
      header: t('columns.details'),
      value: (row) => summarise(row.metadata),
      cell: (row) => (
        <span className="flex flex-col py-1 text-caption">
          {row.metadata && <span className="text-muted">{summarise(row.metadata)}</span>}
          {row.before && (
            <span>
              {t('before')}: {summarise(row.before)}
            </span>
          )}
          {row.after && (
            <span>
              {t('after')}: {summarise(row.after)}
            </span>
          )}
        </span>
      ),
    },
    { id: 'from', header: t('columns.from'), value: (row) => row.ipAddress ?? '', mono: true },
  ];

  const result = verify.data;
  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(filters);
          setOffset(0);
        }}
      >
        <Field label={t('filters.action')} className="w-56">
          <Input
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            placeholder={t('filters.actionPlaceholder')}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Field label={t('filters.entity')} className="w-44">
          <Input
            value={filters.entity}
            onChange={(e) => setFilters({ ...filters, entity: e.target.value })}
            placeholder={t('filters.entityPlaceholder')}
            autoComplete="off"
          />
        </Field>
        <Field label={t('filters.from')}>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </Field>
        <Field label={t('filters.to')}>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </Field>
        <Button type="submit" variant="primary">
          {t('filters.apply')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const empty = { action: '', entity: '', from: '', to: '' };
            setFilters(empty);
            setApplied(empty);
            setOffset(0);
          }}
        >
          {t('filters.clear')}
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
            {verify.isPending ? t('verify.checking') : t('verify.button')}
          </Button>
          <p className="text-caption text-muted">{t('verify.help')}</p>
        </div>
        {verify.isError && <Alert tone="danger" title={t('verify.failed')} />}
        {result &&
          (result.ok ? (
            <Alert tone="success" title={t('verify.ok', { sealed: result.sealed })} />
          ) : (
            <Alert
              tone="danger"
              title={t('verify.broken', {
                seq: result.firstBrokenSeq ?? 0,
                problem: result.problem ?? '',
              })}
            />
          ))}
      </div>

      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={list.isPending}
        density="comfortable"
        empty={<EmptyState title={t('empty.title')} description={t('empty.body')} />}
      />
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 text-small">
          <p className="text-muted" role="status">
            {t('paging.showing', {
              from: offset + 1,
              to: Math.min(offset + PAGE_SIZE, total),
              total,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t('paging.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t('paging.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
