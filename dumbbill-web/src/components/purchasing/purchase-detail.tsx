'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, DataTable, MoneyText, Skeleton, type DataColumn } from '@/components/ui';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { Purchase } from '@/lib/api/schemas/inventory';

type Line = Purchase['lines'][number];

/**
 * One saved purchase, read-only: its lines with the landed cost of each (the supplier's price plus the line's share of the
 * freight), batches and expiry dates, and the total owed. Opened from the purchase list. Nothing can be edited here: a
 * saved purchase is part of the books.
 */
export function PurchaseDetail({ purchaseId }: { purchaseId: string }) {
  const t = useTranslations('Purchases');
  const purchase = useQuery({
    queryKey: ['purchases', 'one', purchaseId],
    queryFn: () => inventoryApi.getPurchase(getBrowserApiClient(), purchaseId),
  });

  if (purchase.isPending) {
    return (
      <div role="status" aria-label={t('loading')} className="flex flex-col gap-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (purchase.isError) {
    const missing =
      purchase.error instanceof ApiError &&
      (purchase.error.status === 404 || purchase.error.status === 403);
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="danger" title={missing ? t('errors.notFound') : t('loadFailed')} />
        <Link href="/purchases" className="text-small underline">
          {t('detail.back')}
        </Link>
      </div>
    );
  }
  const data = purchase.data;
  const columns: DataColumn<Line>[] = [
    {
      id: 'product',
      header: t('grid.product'),
      value: (line) => line.productName,
      cell: (line) => (
        <span className="flex flex-col">
          <span className="font-medium">{line.productName}</span>
          {(line.brand || line.variant) && (
            <span className="text-caption text-muted">
              {[line.brand, line.variant].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    { id: 'qty', header: t('grid.qty'), value: (line) => line.qty, align: 'right', mono: true },
    {
      id: 'unit',
      header: t('grid.unitCost'),
      value: (line) => line.unitCostPaise,
      align: 'right',
      cell: (line) => <MoneyText paise={line.unitCostPaise} />,
    },
    {
      id: 'landedUnit',
      header: t('detail.landedUnit'),
      value: (line) => line.landedUnitCostPaise,
      align: 'right',
      cell: (line) => <MoneyText paise={line.landedUnitCostPaise} tone="muted" />,
    },
    { id: 'batch', header: t('grid.batchNo'), value: (line) => line.batchNo ?? '', mono: true },
    { id: 'expiry', header: t('grid.expiry'), value: (line) => line.expiryDate ?? '', mono: true },
    {
      id: 'total',
      header: t('grid.landed'),
      value: (line) => line.lineTotalPaise,
      align: 'right',
      cell: (line) => <MoneyText paise={line.lineTotalPaise} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <DataTable
        caption={t('detail.lines')}
        columns={columns}
        rows={data.lines}
        getRowId={(line) =>
          `${line.productId}-${line.batchNo ?? ''}-${line.expiryDate ?? ''}-${line.qty}`
        }
        density="comfortable"
      />
      <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-small">
        <dt className="text-muted">{t('detail.subtotal')}</dt>
        <dd className="text-right">
          <MoneyText paise={data.subtotalPaise} />
        </dd>
        <dt className="text-muted">{t('detail.extra')}</dt>
        <dd className="text-right">
          <MoneyText paise={data.otherCostPaise} />
        </dd>
        <dt className="border-t-2 border-rule pt-2 font-medium">{t('detail.total')}</dt>
        <dd className="border-t-2 border-rule pt-2 text-right">
          <MoneyText paise={data.totalPaise} size="total" />
        </dd>
      </dl>
      {data.note && (
        <p className="text-small">
          <span className="text-muted">{t('detail.note')}: </span>
          {data.note}
        </p>
      )}
      {data.createdByName && (
        <p className="text-caption text-muted">
          {t('detail.enteredBy', { name: data.createdByName })}
        </p>
      )}
      <div>
        <Button asChild variant="secondary">
          <Link href="/purchases/returns/new">{t('detail.return')}</Link>
        </Button>
      </div>
    </div>
  );
}
