'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Badge, DataTable, EmptyState, MoneyText, type DataColumn } from '@/components/ui';
import { getBrowserApiClient, productsApi } from '@/lib/api';
import type { Price } from '@/lib/api/schemas/products';
import { formatDateTime } from '@/lib/format/datetime';

/**
 * Every price a product ever had, newest first, with who changed it and why (US-PRICE-01). Scheduled changes are marked
 * "Scheduled", and the one in force now "In force now". Read-only: the history can only be added to.
 */
export function PriceHistory({ productId, refreshKey }: { productId: string; refreshKey: string }) {
  const t = useTranslations('Products');
  const history = useQuery({
    queryKey: ['products', 'prices', productId, refreshKey],
    queryFn: () => productsApi.getPriceHistory(getBrowserApiClient(), productId),
  });

  if (history.isError) return <Alert tone="danger" title={t('loadFailed')} />;

  const columns: DataColumn<Price>[] = [
    {
      id: 'when',
      header: t('history.when'),
      value: (price) => price.effectiveFrom,
      cell: (price) => (
        <span className="flex flex-wrap items-center gap-2">
          {formatDateTime(price.effectiveFrom)}
          {price.current && <Badge variant="success">{t('history.current')}</Badge>}
          {price.scheduled && <Badge variant="warning">{t('history.scheduled')}</Badge>}
        </span>
      ),
    },
    {
      id: 'mrp',
      header: t('history.mrp'),
      value: (price) => price.mrpPaise,
      align: 'right',
      cell: (price) => <MoneyText paise={price.mrpPaise} tone="muted" />,
    },
    {
      id: 'price',
      header: t('history.price'),
      value: (price) => price.pricePaise,
      align: 'right',
      cell: (price) => <MoneyText paise={price.pricePaise} />,
    },
    { id: 'reason', header: t('history.reason'), value: (price) => price.reason },
    { id: 'by', header: t('history.by'), value: (price) => price.changedByName ?? '' },
  ];

  return (
    <DataTable
      caption={t('history.caption')}
      columns={columns}
      rows={history.data ?? []}
      getRowId={(price) => price.id}
      loading={history.isPending}
      density="comfortable"
      empty={<EmptyState title={t('history.empty')} headingLevel={3} />}
    />
  );
}
