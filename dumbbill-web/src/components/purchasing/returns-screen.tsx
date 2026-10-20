'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, DataTable, EmptyState, MoneyText, type DataColumn } from '@/components/ui';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { SupplierReturn } from '@/lib/api/schemas/inventory';
import { formatDateTime } from '@/lib/format/datetime';

/** The debit notes: goods sent back to suppliers, newest first. Needs `purchases.write`. */
export function ReturnsScreen() {
  const t = useTranslations('Purchases');
  const list = useQuery({
    queryKey: ['supplier-returns', 'list'],
    queryFn: () => inventoryApi.listSupplierReturns(getBrowserApiClient()),
  });

  if (list.isError) {
    const denied = list.error instanceof ApiError && list.error.code === 'FORBIDDEN';
    return <Alert tone="danger" title={denied ? t('errors.forbidden') : t('loadFailed')} />;
  }

  const columns: DataColumn<SupplierReturn>[] = [
    {
      id: 'number',
      header: t('returnsPage.columns.number'),
      value: (row) => row.debitNoteNo,
      mono: true,
      sortable: true,
    },
    {
      id: 'date',
      header: t('returnsPage.columns.date'),
      value: (row) => row.createdAt,
      sortable: true,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      id: 'supplier',
      header: t('returnsPage.columns.supplier'),
      value: (row) => row.supplierName,
      sortable: true,
    },
    { id: 'branch', header: t('returnsPage.columns.branch'), value: (row) => row.branchName },
    { id: 'reason', header: t('returnsPage.columns.reason'), value: (row) => row.reason },
    {
      id: 'credit',
      header: t('returnsPage.columns.credit'),
      value: (row) => row.creditTotalPaise,
      align: 'right',
      cell: (row) => <MoneyText paise={row.creditTotalPaise} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button asChild variant="ghost">
          <Link href="/purchases">{t('returnsPage.back')}</Link>
        </Button>
        <Button asChild variant="primary">
          <Link href="/purchases/returns/new">{t('returnsPage.new')}</Link>
        </Button>
      </div>
      <DataTable
        caption={t('returnsPage.caption')}
        columns={columns}
        rows={list.data ?? []}
        getRowId={(row) => row.id}
        loading={list.isPending}
        density="comfortable"
        empty={
          <EmptyState
            title={t('returnsPage.empty.title')}
            description={t('returnsPage.empty.body')}
          />
        }
      />
    </div>
  );
}
