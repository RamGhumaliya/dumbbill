'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, DataTable, EmptyState, MoneyText, type DataColumn } from '@/components/ui';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { PurchaseSummary } from '@/lib/api/schemas/inventory';

const PAGE_SIZE = 50;

/**
 * The list of purchases (supplier bills), newest first. A saved purchase is never edited: it is opened to read, and a
 * mistake is corrected with a debit note (goods back to the supplier) or a stock count. Needs `purchases.write`.
 */
export function PurchasesScreen() {
  const t = useTranslations('Purchases');
  const [offset, setOffset] = useState(0);
  const list = useQuery({
    queryKey: ['purchases', 'list', offset],
    queryFn: () => inventoryApi.listPurchases(getBrowserApiClient(), { limit: PAGE_SIZE, offset }),
    placeholderData: (previous) => previous,
  });

  if (list.isError && !list.data) {
    const denied = list.error instanceof ApiError && list.error.code === 'FORBIDDEN';
    return (
      <Alert tone="danger" title={denied ? t('errors.forbidden') : t('loadFailed')}>
        {!denied && (
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            {t('retry')}
          </Button>
        )}
      </Alert>
    );
  }

  const total = list.data?.total ?? 0;
  const columns: DataColumn<PurchaseSummary>[] = [
    {
      id: 'invoice',
      header: t('columns.invoice'),
      value: (purchase) => purchase.invoiceRef,
      sortable: true,
      cell: (purchase) => (
        <Link href={`/purchases/${purchase.id}`} className="font-medium underline">
          {purchase.invoiceRef}
        </Link>
      ),
    },
    {
      id: 'date',
      header: t('columns.date'),
      value: (purchase) => purchase.invoiceDate,
      sortable: true,
      mono: true,
    },
    {
      id: 'supplier',
      header: t('columns.supplier'),
      value: (purchase) => purchase.supplierName,
      sortable: true,
    },
    { id: 'branch', header: t('columns.branch'), value: (purchase) => purchase.branchName },
    {
      id: 'lines',
      header: t('columns.lines'),
      value: (purchase) => purchase.lineCount,
      align: 'right',
      cell: (purchase) => t('linesValue', { count: purchase.lineCount }),
    },
    {
      id: 'total',
      header: t('columns.total'),
      value: (purchase) => purchase.totalPaise,
      align: 'right',
      sortable: true,
      cell: (purchase) => <MoneyText paise={purchase.totalPaise} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button asChild variant="secondary">
          <Link href="/purchases/returns">{t('returns')}</Link>
        </Button>
        <Button asChild variant="primary">
          <Link href="/purchases/new">{t('record')}</Link>
        </Button>
      </div>
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(purchase) => purchase.id}
        loading={list.isPending}
        density="comfortable"
        empty={
          <EmptyState
            title={t('empty.title')}
            description={t('empty.body')}
            action={
              <Button asChild variant="primary">
                <Link href="/purchases/new">{t('record')}</Link>
              </Button>
            }
          />
        }
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
