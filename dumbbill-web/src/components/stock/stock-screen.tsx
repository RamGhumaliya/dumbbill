'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  MoneyText,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataColumn,
} from '@/components/ui';
import { ApiError, businessApi, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { StockRow } from '@/lib/api/schemas/inventory';
import { useCan } from '@/lib/auth/use-can';
import { AlertsPanel } from './alerts-panel';
import { CountDialog } from './count-dialog';
import { LedgerDialog } from './ledger-dialog';
import { TransfersPanel } from './transfers-panel';

const PAGE_SIZE = 50;

/**
 * The stock page (US-STK-01, US-STK-02): pick a branch, see what it holds, drill into the history of any product, count
 * stock, and (in other tabs) see alerts and move goods between branches.
 *
 * Quantities are for anyone who can read products. The average cost and stock value columns exist only for people with
 * `products.cost.read` (the server never sends them to anyone else). The History, Count, Alerts and Transfers features
 * appear only for people holding `stock.adjust` / `stock.transfer`; the server enforces both anyway.
 */
export function StockScreen() {
  const t = useTranslations('Stock');
  const canAdjust = useCan('stock.adjust');
  const canTransfer = useCan('stock.transfer');
  const canSeeCost = useCan('products.cost.read');

  const branches = useQuery({
    queryKey: ['branches', 'list'],
    queryFn: () => businessApi.listBranches(getBrowserApiClient()),
  });
  const activeBranches = (branches.data?.branches ?? []).filter((branch) => branch.isActive);
  const [chosen, setChosen] = useState<string | null>(null);
  const branchId = chosen ?? activeBranches[0]?.id ?? null;
  const branch = activeBranches.find((b) => b.id === branchId);

  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<StockRow | null>(null);
  const [counting, setCounting] = useState<StockRow | null>(null);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(searchText.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const stock = useQuery({
    queryKey: ['stock', 'list', { branchId, q, lowOnly, offset }],
    queryFn: () =>
      inventoryApi.listStock(getBrowserApiClient(), {
        branchId: branchId as string,
        q: q || undefined,
        lowOnly: lowOnly || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: Boolean(branchId),
    placeholderData: (previous) => previous,
  });

  if (branches.isPending)
    return (
      <p role="status" className="text-small text-muted">
        {t('loading')}
      </p>
    );
  if (branches.isError) return <Alert tone="danger" title={t('loadFailed')} />;
  if (!branchId || !branch) return <Alert tone="info" title={t('noBranch')} />;

  if (stock.isError && !stock.data) {
    const denied = stock.error instanceof ApiError && stock.error.code === 'FORBIDDEN';
    return (
      <Alert tone="danger" title={denied ? t('errors.forbidden') : t('loadFailed')}>
        {!denied && (
          <Button variant="secondary" size="sm" onClick={() => void stock.refetch()}>
            {t('retry')}
          </Button>
        )}
      </Alert>
    );
  }

  const total = stock.data?.total ?? 0;
  const columns: DataColumn<StockRow>[] = [
    {
      id: 'product',
      header: t('columns.product'),
      value: (row) => row.productName,
      sortable: true,
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.productName}</span>
          {(row.brand || row.variant) && (
            <span className="text-caption text-muted">
              {[row.brand, row.variant].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'qty',
      header: t('columns.qty'),
      value: (row) => row.qty,
      align: 'right',
      sortable: true,
      cell: (row) => (
        <span className="flex items-center justify-end gap-2">
          {row.isLow && <Badge variant="warning">{t('low')}</Badge>}
          <span className="font-mono">{row.qty}</span>
        </span>
      ),
    },
    {
      id: 'level',
      header: t('columns.level'),
      value: (row) => row.minQty ?? -1,
      align: 'right',
      mono: true,
      cell: (row) => (row.minQty === null ? t('noLevel') : row.minQty),
    },
    ...(canSeeCost
      ? [
          {
            id: 'wac',
            header: t('columns.wac'),
            value: (row: StockRow) => row.wacPaise ?? 0,
            align: 'right' as const,
            cell: (row: StockRow) =>
              row.wacPaise === undefined ? '' : <MoneyText paise={row.wacPaise} tone="muted" />,
          },
          {
            id: 'value',
            header: t('columns.value'),
            value: (row: StockRow) => row.valuePaise ?? 0,
            align: 'right' as const,
            sortable: true,
            cell: (row: StockRow) =>
              row.valuePaise === undefined ? '' : <MoneyText paise={row.valuePaise} />,
          },
        ]
      : []),
    ...(canAdjust
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            align: 'right' as const,
            value: () => null,
            cell: (row: StockRow) => (
              <span className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('historyLabel', { name: row.productName })}
                  onClick={() => setHistory(row)}
                >
                  {t('history')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('countLabel', { name: row.productName })}
                  onClick={() => setCounting(row)}
                >
                  {t('count')}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  const filtered = q !== '' || lowOnly;
  return (
    <div className="flex flex-col gap-6">
      <Field label={t('branch')} className="max-w-xs">
        <Select
          value={branchId}
          onValueChange={(value) => {
            setChosen(value);
            setOffset(0);
          }}
          options={activeBranches.map((b) => ({ value: b.id, label: b.name }))}
        />
      </Field>

      <Tabs defaultValue="stock">
        <TabsList aria-label={t('tabsLabel')}>
          <TabsTrigger value="stock">{t('tabs.stock')}</TabsTrigger>
          {canAdjust && <TabsTrigger value="alerts">{t('tabs.alerts')}</TabsTrigger>}
          {canTransfer && <TabsTrigger value="transfers">{t('tabs.transfers')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="stock" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('search')} className="min-w-56 flex-1">
              <Input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={t('searchPlaceholder')}
                autoComplete="off"
              />
            </Field>
            <Checkbox
              label={t('lowOnly')}
              checked={lowOnly}
              onCheckedChange={(on) => {
                setLowOnly(on === true);
                setOffset(0);
              }}
              className="pb-2"
            />
          </div>
          <DataTable
            caption={t('caption', { branch: branch.name })}
            columns={columns}
            rows={stock.data?.items ?? []}
            getRowId={(row) => row.productId}
            loading={stock.isPending}
            density="comfortable"
            empty={
              <EmptyState
                title={filtered ? t('empty.filtered') : t('empty.title')}
                description={filtered ? undefined : t('empty.body')}
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
        </TabsContent>

        {canAdjust && (
          <TabsContent value="alerts">
            <AlertsPanel branchId={branchId} canWriteOff={canAdjust} />
          </TabsContent>
        )}
        {canTransfer && (
          <TabsContent value="transfers">
            <TransfersPanel branches={branches.data.branches} currentBranchId={branchId} />
          </TabsContent>
        )}
      </Tabs>

      {history && (
        <LedgerDialog
          branchId={branchId}
          branchName={branch.name}
          product={{ id: history.productId, name: history.productName }}
          onClose={() => setHistory(null)}
        />
      )}
      {counting && (
        <CountDialog
          branchId={branchId}
          row={counting}
          canAdjust={canAdjust}
          onClose={() => setCounting(null)}
        />
      )}
    </div>
  );
}
