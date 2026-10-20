'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  useToast,
  type DataColumn,
} from '@/components/ui';
import { ApiError, getBrowserApiClient, productsApi } from '@/lib/api';
import type { Product } from '@/lib/api/schemas/products';
import { useCan } from '@/lib/auth/use-can';
import {
  formatBasisPoints,
  formatPaise,
  paiseToRupeeText,
  parseRupeesToPaise,
} from '@/lib/format/money';
import { describeFailure, type FailureView } from '../business/business-errors';
import { PriceDialog } from './price-dialog';

const PAGE_SIZE = 50;
const COLUMNS_STORAGE_KEY = 'dumbbill.products.columns';

/** Columns the person can hide. The product name is always shown. */
const PICKABLE = [
  'category',
  'barcode',
  'sku',
  'hsn',
  'gst',
  'mrp',
  'price',
  'cost',
  'margin',
  'status',
] as const;
type Pickable = (typeof PICKABLE)[number];

/** What is shown the first time: the everyday columns. SKU and HSN are one click away. */
const DEFAULT_VISIBLE: Record<Pickable, boolean> = {
  category: true,
  barcode: true,
  sku: false,
  hsn: false,
  gst: true,
  mrp: true,
  price: true,
  cost: true,
  margin: true,
  status: true,
};

/** Read the remembered column choice. It is a per-person convenience, so any problem just means "use the defaults". */
function loadVisibleColumns(): Record<Pickable, boolean> {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE;
  try {
    const stored = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored)
      return { ...DEFAULT_VISIBLE, ...(JSON.parse(stored) as Partial<Record<Pickable, boolean>>) };
  } catch {
    // Private window or blocked storage: fall through to the defaults.
  }
  return DEFAULT_VISIBLE;
}

/** Move keyboard focus to the price button of another row (Arrow Up / Down in the price column). */
function focusPriceCell(row: number): void {
  document.querySelector<HTMLElement>(`[data-price-cell="${row}"]`)?.focus();
}

/**
 * One price in the table. Shows the amount as a button; Enter (or a click) turns it into a small box, Enter again hands
 * the new amount to the "Change price" dialog (which asks WHY and records who), Escape cancels. Arrow Up and Down move
 * between the prices of neighbouring rows without leaving the keyboard.
 *
 * Nothing is saved from the cell itself: a price change needs a reason, so the dialog always has the last word.
 */
function InlinePriceCell({
  product,
  row,
  onPropose,
  label,
}: {
  product: Product;
  row: number;
  onPropose: (product: Product, newPricePaise: number) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (editing) {
    const typed = parseRupeesToPaise(text);
    const valid = typed !== null && typed > 0 && typed <= product.mrpPaise;
    return (
      <Input
        ref={input}
        value={text}
        onChange={(event) => setText(event.target.value)}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={!valid || undefined}
        className="ml-auto h-(--size-control-sm) w-28 text-right font-mono"
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (valid && typed !== product.pricePaise) onPropose(product, typed);
            setEditing(false);
          }
        }}
      />
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusPriceCell(row + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusPriceCell(row - 1);
    }
  };

  return (
    <button
      type="button"
      data-price-cell={row}
      aria-label={label}
      onClick={() => {
        setText(paiseToRupeeText(product.pricePaise));
        setEditing(true);
      }}
      onKeyDown={onKeyDown}
      className="ml-auto block rounded-control px-2 py-1 text-right hover:bg-hover"
    >
      <MoneyText paise={product.pricePaise} />
    </button>
  );
}

/**
 * The products table (US-PROD-01): dense rows, a sticky header, search and filters, a column picker, and prices you can
 * change from the keyboard. People with `products.cost.read` also get cost and margin columns; for everyone else those
 * columns do not exist at all (the API never sends the numbers).
 *
 * Switching a product off hides it from the till and the default list but keeps its history; products are never deleted.
 */
export function ProductsScreen() {
  const t = useTranslations('Products');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan('products.write');
  const canPrice = useCan('pricing.write');
  const canSeeCost = useCan('products.cost.read');

  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [offset, setOffset] = useState(0);
  // Read once when the screen first appears. (Behind the sign-in gate this never renders on the server.)
  const [visible, setVisible] = useState<Record<Pickable, boolean>>(loadVisibleColumns);
  const [pricing, setPricing] = useState<{ product: Product; suggested: number } | null>(null);
  const [failure, setFailure] = useState<FailureView | null>(null);

  // Wait for a pause in typing before searching, so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(searchText.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const options = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => productsApi.getProductOptions(getBrowserApiClient()),
  });
  const list = useQuery({
    queryKey: ['products', 'list', { q, categoryId, status, offset }],
    queryFn: () =>
      productsApi.listProducts(getBrowserApiClient(), {
        q: q || undefined,
        categoryId: categoryId === 'all' ? undefined : categoryId,
        status,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: (previous) => previous,
  });

  const toggleActive = useMutation({
    mutationFn: ({ product, on }: { product: Product; on: boolean }) =>
      on
        ? productsApi.activateProduct(getBrowserApiClient(), product.id)
        : productsApi.deactivateProduct(getBrowserApiClient(), product.id),
    onSuccess: async (_saved, { on }) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: on ? t('toast.on') : t('toast.off'), tone: 'success' });
    },
    onError: (error) =>
      setFailure(
        describeFailure(error, {
          title: t('errors.title'),
          network: t('errors.network'),
          forbidden: t('errors.forbidden'),
          generic: t('errors.generic'),
        }),
      ),
  });

  const setColumn = (id: Pickable, on: boolean) => {
    const next = { ...visible, [id]: on };
    setVisible(next);
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Blocked storage: the choice just lasts until the page is closed.
    }
  };

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

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const show = (id: Pickable): boolean =>
    visible[id] && (id !== 'cost' && id !== 'margin' ? true : canSeeCost);

  const columns: DataColumn<Product>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      value: (product) => product.name,
      sortable: true,
      cell: (product) => (
        <span className="flex flex-col">
          <span className="font-medium">{product.name}</span>
          {(product.variant || product.brand) && (
            <span className="text-caption text-muted">
              {[product.brand, product.variant].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    ...(show('category')
      ? [
          {
            id: 'category',
            header: t('columns.category'),
            value: (p: Product) => p.categoryName ?? '',
            sortable: true,
          },
        ]
      : []),
    ...(show('barcode')
      ? [
          {
            id: 'barcode',
            header: t('columns.barcode'),
            value: (p: Product) => p.barcode ?? '',
            mono: true,
          },
        ]
      : []),
    ...(show('sku')
      ? [{ id: 'sku', header: t('columns.sku'), value: (p: Product) => p.sku ?? '', mono: true }]
      : []),
    ...(show('hsn')
      ? [{ id: 'hsn', header: t('columns.hsn'), value: (p: Product) => p.hsn ?? '', mono: true }]
      : []),
    ...(show('gst')
      ? [
          {
            id: 'gst',
            header: t('columns.gst'),
            value: (p: Product) => p.gstRateBp ?? -1,
            align: 'right' as const,
            mono: true,
            cell: (p: Product) =>
              p.gstRateBp === null ? t('noValue') : t('gstValue', { percent: p.gstRateBp / 100 }),
          },
        ]
      : []),
    ...(show('mrp')
      ? [
          {
            id: 'mrp',
            header: t('columns.mrp'),
            value: (p: Product) => p.mrpPaise,
            align: 'right' as const,
            sortable: true,
            cell: (p: Product) => <MoneyText paise={p.mrpPaise} tone="muted" />,
          },
        ]
      : []),
    ...(show('price')
      ? [
          {
            id: 'price',
            header: t('columns.price'),
            value: (p: Product) => p.pricePaise,
            align: 'right' as const,
            sortable: true,
            cell: (p: Product) =>
              canPrice ? (
                <InlinePriceCell
                  product={p}
                  row={rows.indexOf(p)}
                  label={t('inline.edit', { name: p.name, price: formatPaise(p.pricePaise) })}
                  onPropose={(product, suggested) => setPricing({ product, suggested })}
                />
              ) : (
                <MoneyText paise={p.pricePaise} />
              ),
          },
        ]
      : []),
    ...(show('cost')
      ? [
          {
            id: 'cost',
            header: t('columns.cost'),
            value: (p: Product) => p.purchaseCostPaise ?? -1,
            align: 'right' as const,
            sortable: true,
            cell: (p: Product) =>
              p.purchaseCostPaise === null || p.purchaseCostPaise === undefined ? (
                t('noValue')
              ) : (
                <MoneyText paise={p.purchaseCostPaise} tone="muted" />
              ),
          },
        ]
      : []),
    ...(show('margin')
      ? [
          {
            id: 'margin',
            header: t('columns.margin'),
            value: (p: Product) => p.marginBp ?? -1,
            align: 'right' as const,
            mono: true,
            cell: (p: Product) =>
              p.marginBp === null || p.marginBp === undefined ? (
                t('noValue')
              ) : (
                <span className={p.belowCost ? 'font-medium text-danger' : undefined}>
                  {formatBasisPoints(p.marginBp)}
                  {p.belowCost && <span className="sr-only"> ({t('status.belowCost')})</span>}
                </span>
              ),
          },
        ]
      : []),
    ...(show('status')
      ? [
          {
            id: 'status',
            header: t('columns.status'),
            value: (p: Product) => (p.isActive ? 1 : 0),
            cell: (p: Product) => (
              <span className="flex flex-wrap gap-1">
                <Badge variant={p.isActive ? 'success' : 'neutral'}>
                  {p.isActive ? t('status.active') : t('status.off')}
                </Badge>
                {p.belowCost && <Badge variant="danger">{t('status.belowCost')}</Badge>}
              </span>
            ),
          },
        ]
      : []),
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            align: 'right' as const,
            value: () => null,
            cell: (p: Product) => (
              <span className="flex justify-end gap-1">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/products/${p.id}`} aria-label={t('editLabel', { name: p.name })}>
                    {t('edit')}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={
                    p.isActive
                      ? t('switchOffLabel', { name: p.name })
                      : t('switchOnLabel', { name: p.name })
                  }
                  onClick={() => {
                    setFailure(null);
                    toggleActive.mutate({ product: p, on: !p.isActive });
                  }}
                >
                  {p.isActive ? t('switchOff') : t('switchOn')}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  const filtered = q !== '' || categoryId !== 'all' || status !== 'active';
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-5">
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
        <Field label={t('filters.category')} className="w-52">
          <Select
            value={categoryId}
            onValueChange={(value) => {
              setCategoryId(value);
              setOffset(0);
            }}
            options={[
              { value: 'all', label: t('filters.allCategories') },
              ...(options.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </Field>
        <Field label={t('filters.status')} className="w-52">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as 'active' | 'inactive' | 'all');
              setOffset(0);
            }}
            options={[
              { value: 'active', label: t('filters.active') },
              { value: 'inactive', label: t('filters.inactive') },
              { value: 'all', label: t('filters.all') },
            ]}
          />
        </Field>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">{t('columns.picker')}</Button>
          </PopoverTrigger>
          <PopoverContent align="end">
            <p className="mb-3 text-caption text-muted">{t('columns.pickerHint')}</p>
            <div className="flex flex-col gap-2">
              {PICKABLE.filter((id) => canSeeCost || (id !== 'cost' && id !== 'margin')).map(
                (id) => (
                  <Checkbox
                    key={id}
                    label={t(`columns.${id}`)}
                    checked={visible[id]}
                    onCheckedChange={(on) => setColumn(id, on === true)}
                  />
                ),
              )}
            </div>
          </PopoverContent>
        </Popover>
        {canWrite && (
          <>
            <Button asChild variant="secondary">
              <Link href="/products/import">{t('import')}</Link>
            </Button>
            <Button asChild variant="primary">
              <Link href="/products/new">{t('add')}</Link>
            </Button>
          </>
        )}
      </div>

      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
          {failure.reference && (
            <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
          )}
        </Alert>
      )}
      {canPrice && <p className="text-caption text-muted">{t('inline.hint')}</p>}

      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={rows}
        getRowId={(product) => product.id}
        loading={list.isPending}
        empty={
          <EmptyState
            title={filtered ? t('empty.filtered') : t('empty.title')}
            description={filtered ? undefined : t('empty.body')}
            action={
              !filtered && canWrite ? (
                <Button asChild variant="primary">
                  <Link href="/products/new">{t('add')}</Link>
                </Button>
              ) : undefined
            }
          />
        }
      />

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 text-small">
          <p className="text-muted" role="status">
            {t('paging.showing', { from, to, total })}
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

      {pricing && (
        <PriceDialog
          product={pricing.product}
          suggestedPricePaise={pricing.suggested}
          open
          onOpenChange={(open) => !open && setPricing(null)}
        />
      )}
    </div>
  );
}
