'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  useToast,
  type DataColumn,
} from '@/components/ui';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { ExpiryAlert } from '@/lib/api/schemas/inventory';
import { describeFailure, type FailureView } from '../business/business-errors';

/** Write off (part of) an expired batch. One Idempotency-Key per opening, so a double tap writes off once. */
function WriteOffDialog({ alert, onClose }: { alert: ExpiryAlert; onClose: () => void }) {
  const t = useTranslations('Stock');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(String(alert.qtyRemaining));
  const [problem, setProblem] = useState<string | undefined>();
  const [failure, setFailure] = useState<FailureView | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const writeOff = useMutation({
    mutationFn: () =>
      inventoryApi.writeOffExpiredStock(
        getBrowserApiClient(),
        { branchId: alert.branchId, batchId: alert.batchId, qty: Number(qty) },
        idempotencyKey.current,
      ),
  });

  const submit = async () => {
    setFailure(null);
    const number = Number(qty);
    if (!/^[1-9][0-9]{0,6}$/.test(qty) || number > alert.qtyRemaining) {
      setProblem(t('writeOffDialog.qtyHint', { qty: alert.qtyRemaining }));
      return;
    }
    setProblem(undefined);
    try {
      await writeOff.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast({ title: t('writeOffDialog.saved'), tone: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
        setProblem(t('writeOffDialog.qtyHint', { qty: alert.qtyRemaining }));
        return;
      }
      setFailure(
        describeFailure(error, {
          title: t('errors.title'),
          network: t('errors.network'),
          forbidden: t('errors.forbidden'),
          generic: t('errors.generic'),
        }),
      );
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('writeOffDialog.title', { product: alert.productName })}
      description={t('writeOffDialog.description', {
        batch: alert.batchNo ?? '-',
        date: alert.expiryDate,
      })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ledger.close')}
          </Button>
          <Button variant="danger" loading={writeOff.isPending} onClick={() => void submit()}>
            {t('writeOffDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
          </Alert>
        )}
        <Field
          label={t('writeOffDialog.qty')}
          hint={t('writeOffDialog.qtyHint', { qty: alert.qtyRemaining })}
          error={problem}
          required
        >
          <Input
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            className="font-mono"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * What needs attention at a branch: low stock, batches expiring soon, and batches already expired that still hold units
 * (US-STK-02). The near-expiry window is the business's own setting. Expired batches can be written off from here (the
 * server refuses to write off a batch that has not expired). Needs `stock.adjust`.
 */
export function AlertsPanel({ branchId, canWriteOff }: { branchId: string; canWriteOff: boolean }) {
  const t = useTranslations('Stock');
  const [writingOff, setWritingOff] = useState<ExpiryAlert | null>(null);
  const alerts = useQuery({
    queryKey: ['stock', 'alerts', branchId],
    queryFn: () => inventoryApi.getStockAlerts(getBrowserApiClient(), branchId),
  });

  if (alerts.isPending)
    return (
      <p role="status" className="text-small text-muted">
        {t('alerts.loading')}
      </p>
    );
  if (alerts.isError) return <Alert tone="danger" title={t('alerts.loadFailed')} />;
  const data = alerts.data;

  const expiryColumns = (withAction: boolean): DataColumn<ExpiryAlert>[] => [
    { id: 'product', header: t('alerts.product'), value: (row) => row.productName, sortable: true },
    { id: 'batch', header: t('alerts.batch'), value: (row) => row.batchNo ?? '', mono: true },
    {
      id: 'expires',
      header: t('alerts.expires'),
      value: (row) => row.expiryDate,
      mono: true,
      sortable: true,
    },
    {
      id: 'days',
      header: '',
      value: (row) => row.daysLeft,
      cell: (row) =>
        row.daysLeft >= 0
          ? t('alerts.daysLeft', { days: row.daysLeft })
          : t('alerts.daysAgo', { days: -row.daysLeft }),
    },
    {
      id: 'left',
      header: t('alerts.left'),
      value: (row) => row.qtyRemaining,
      align: 'right',
      mono: true,
    },
    ...(withAction && canWriteOff
      ? [
          {
            id: 'action',
            header: '',
            align: 'right' as const,
            value: () => null,
            cell: (row: ExpiryAlert) => (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('alerts.writeOffLabel', {
                  product: row.productName,
                  batch: row.batchNo ?? '-',
                })}
                onClick={() => setWritingOff(row)}
              >
                {t('alerts.writeOff')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <p className="text-small text-muted">{t('alerts.window', { days: data.nearExpiryDays })}</p>

      <section aria-labelledby="low-heading" className="flex flex-col gap-3">
        <h3
          id="low-heading"
          className="text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('alerts.low.heading')}
        </h3>
        <DataTable
          caption={t('alerts.low.caption')}
          columns={[
            {
              id: 'product',
              header: t('alerts.low.product'),
              value: (row) => row.productName,
              sortable: true,
            },
            { id: 'branch', header: t('alerts.low.branch'), value: (row) => row.branchName },
            {
              id: 'qty',
              header: t('alerts.low.qty'),
              value: (row) => row.qty,
              align: 'right',
              mono: true,
            },
            {
              id: 'level',
              header: t('alerts.low.level'),
              value: (row) => row.minQty,
              align: 'right',
              mono: true,
            },
          ]}
          rows={data.lowStock}
          getRowId={(row) => `${row.branchId}-${row.productId}`}
          density="comfortable"
          empty={<p className="p-4 text-small text-muted">{t('alerts.low.empty')}</p>}
        />
      </section>

      <section aria-labelledby="near-heading" className="flex flex-col gap-3">
        <h3
          id="near-heading"
          className="text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('alerts.near.heading')}
        </h3>
        <DataTable
          caption={t('alerts.near.caption')}
          columns={expiryColumns(false)}
          rows={data.nearExpiry}
          getRowId={(row) => row.batchId}
          density="comfortable"
          empty={<p className="p-4 text-small text-muted">{t('alerts.near.empty')}</p>}
        />
      </section>

      <section aria-labelledby="expired-heading" className="flex flex-col gap-3">
        <h3
          id="expired-heading"
          className="text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('alerts.expired.heading')}
        </h3>
        <DataTable
          caption={t('alerts.expired.caption')}
          columns={expiryColumns(true)}
          rows={data.expired}
          getRowId={(row) => row.batchId}
          density="comfortable"
          empty={<p className="p-4 text-small text-muted">{t('alerts.expired.empty')}</p>}
        />
      </section>

      {writingOff && <WriteOffDialog alert={writingOff} onClose={() => setWritingOff(null)} />}
    </div>
  );
}
