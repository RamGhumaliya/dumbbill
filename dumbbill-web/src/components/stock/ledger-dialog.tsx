'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, DataTable, Dialog, MoneyText, type DataColumn } from '@/components/ui';
import { getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { LedgerEntry } from '@/lib/api/schemas/inventory';
import { useCan } from '@/lib/auth/use-can';
import { formatDateTime } from '@/lib/format/datetime';

const PAGE_SIZE = 20;

/**
 * The ledger drilldown (US-STK-01): every movement of one product at one branch, newest first, so the person can see how
 * the number on the stock page came about. Nothing here can be edited: the ledger only ever grows.
 *
 * Cost columns (what each movement was worth, the average after it) are shown only to people with `products.cost.read`;
 * for everyone else the server does not send them at all.
 */
export function LedgerDialog({
  branchId,
  branchName,
  product,
  onClose,
}: {
  branchId: string;
  branchName: string;
  product: { id: string; name: string };
  onClose: () => void;
}) {
  const t = useTranslations('Stock');
  const canSeeCost = useCan('products.cost.read');
  const [offset, setOffset] = useState(0);
  const ledger = useQuery({
    queryKey: ['stock', 'ledger', branchId, product.id, offset],
    queryFn: () =>
      inventoryApi.listStockLedger(getBrowserApiClient(), {
        branchId,
        productId: product.id,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (previous) => previous,
  });
  const total = ledger.data?.total ?? 0;

  const columns: DataColumn<LedgerEntry>[] = [
    {
      id: 'when',
      header: t('ledger.when'),
      value: (entry) => entry.createdAt,
      cell: (entry) => formatDateTime(entry.createdAt),
    },
    { id: 'type', header: t('ledger.type'), value: (entry) => t(`types.${entry.type}`) },
    {
      id: 'change',
      header: t('ledger.change'),
      value: (entry) => entry.qtyDelta,
      align: 'right',
      mono: true,
      cell: (entry) => (
        <span className={entry.qtyDelta < 0 ? 'text-danger' : undefined}>
          {entry.qtyDelta > 0 ? `+${entry.qtyDelta}` : entry.qtyDelta}
        </span>
      ),
    },
    {
      id: 'after',
      header: t('ledger.after'),
      value: (entry) => entry.qtyAfter,
      align: 'right',
      mono: true,
    },
    {
      id: 'batch',
      header: t('ledger.batch'),
      value: (entry) => entry.batchNo ?? '',
      mono: true,
      cell: (entry) =>
        entry.batchNo ? (
          <span className="flex flex-col">
            <span>{entry.batchNo}</span>
            {entry.expiryDate && (
              <span className="text-caption text-muted">{entry.expiryDate}</span>
            )}
          </span>
        ) : (
          ''
        ),
    },
    ...(canSeeCost
      ? [
          {
            id: 'unitCost',
            header: t('ledger.unitCost'),
            value: (entry: LedgerEntry) => entry.unitCostPaise ?? 0,
            align: 'right' as const,
            cell: (entry: LedgerEntry) =>
              entry.unitCostPaise === undefined ? (
                ''
              ) : (
                <MoneyText paise={entry.unitCostPaise} tone="muted" />
              ),
          },
          {
            id: 'value',
            header: t('ledger.value'),
            value: (entry: LedgerEntry) => entry.valueDeltaPaise ?? 0,
            align: 'right' as const,
            cell: (entry: LedgerEntry) =>
              entry.valueDeltaPaise === undefined ? (
                ''
              ) : (
                <MoneyText paise={entry.valueDeltaPaise} />
              ),
          },
          {
            id: 'average',
            header: t('ledger.average'),
            value: (entry: LedgerEntry) => entry.wacAfterPaise ?? 0,
            align: 'right' as const,
            cell: (entry: LedgerEntry) =>
              entry.wacAfterPaise === undefined ? (
                ''
              ) : (
                <MoneyText paise={entry.wacAfterPaise} tone="muted" />
              ),
          },
        ]
      : []),
    {
      id: 'why',
      header: t('ledger.why'),
      value: (entry) => entry.reason ?? '',
      cell: (entry) => (
        <span className="flex flex-col">
          <span>
            {entry.reason
              ? t.has(`reasons.${entry.reason}` as never)
                ? t(`reasons.${entry.reason}` as never)
                : entry.reason
              : ''}
          </span>
          {entry.note && <span className="text-caption text-muted">{entry.note}</span>}
        </span>
      ),
    },
    { id: 'by', header: t('ledger.by'), value: (entry) => entry.createdByName ?? '' },
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('ledger.title', { name: product.name })}
      description={t('ledger.description', { branch: branchName })}
      className="max-w-5xl"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('ledger.close')}
        </Button>
      }
    >
      {ledger.isError ? (
        <Alert tone="danger" title={t('ledger.loadFailed')} />
      ) : (
        <div className="flex flex-col gap-3">
          <DataTable
            caption={t('ledger.caption')}
            columns={columns}
            rows={ledger.data?.items ?? []}
            getRowId={(entry) => entry.id}
            loading={ledger.isPending}
            empty={<p className="p-4 text-small text-muted">{t('ledger.empty')}</p>}
          />
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-small">
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
      )}
    </Dialog>
  );
}
