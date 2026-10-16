'use client';

import { useTranslations } from 'next-intl';
import { Button, EmptyState, IconButton, Input, MoneyText } from '@/components/ui';
import { CloseIcon, MinusIcon } from '@/components/ui/icons';
import {
  linePreviewPaise,
  previewSubtotalPaise,
  usePosCart,
  type CartProduct,
} from '@/stores/pos-cart';

/*
 * Sample products that stand in for the real catalogue until products exist (Phase 1).
 * Prices are in paise: 489900 = Rs 4,899.00.
 */
const SAMPLE_PRODUCTS: readonly CartProduct[] = [
  {
    productId: 'sample-whey-2lb',
    name: 'Gold Standard Whey 2 lb, Double Rich Chocolate',
    unitPricePaise: 489_900,
  },
  {
    productId: 'sample-creatine-250g',
    name: 'Creatine Monohydrate 250 g, Unflavoured',
    unitPricePaise: 89_900,
  },
  { productId: 'sample-shaker-700ml', name: 'Gym Shaker 700 ml, Black', unitPricePaise: 34_900 },
];

/**
 * The till screen: the bill on the left, the totals on the right.
 * This is the layout skeleton with a working in-memory bill; scanning, discounts, GST, payment and
 * printing are added in Phase 2. The subtotal shown is a PREVIEW; the server calculates the real bill.
 * Built from the design system (src/components/ui): buttons are at least 48 px where they matter at a counter.
 */
export function PosScreen() {
  const t = useTranslations('Pos');
  const { lines, addItem, setQuantity, removeItem, clear } = usePosCart();
  const subtotal = previewSubtotalPaise(lines);

  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      {/* ---- Left: the bill ---- */}
      <section
        aria-labelledby="bill-title"
        className="flex flex-col gap-4 border-line p-4 sm:p-6 lg:border-r"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1
            id="bill-title"
            className="font-display text-heading font-bold tracking-wide uppercase"
          >
            {t('title')}
          </h1>
          <p className="text-small text-muted">{t('branch')}</p>
        </div>

        {/* Real search and barcode scanning arrive in Phase 2. Shown disabled so the layout is honest. */}
        <Input type="search" disabled placeholder={t('searchHint')} aria-label={t('searchHint')} />

        {lines.length === 0 ? (
          <EmptyState title={t('empty')} headingLevel={2} />
        ) : (
          <table className="w-full text-small">
            <caption className="sr-only">{t('totals.heading')}</caption>
            <thead>
              <tr className="border-b-2 border-rule text-left text-micro tracking-wider text-muted uppercase">
                <th scope="col" className="py-2 pr-2 font-medium">
                  {t('columns.item')}
                </th>
                <th scope="col" className="px-2 py-2 text-center font-medium">
                  {t('columns.quantity')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  {t('columns.price')}
                </th>
                <th scope="col" className="py-2 pl-2 text-right font-medium">
                  {t('columns.amount')}
                </th>
                <th scope="col" className="w-12">
                  <span className="sr-only">{t('columns.remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.productId} className="border-b border-line align-middle">
                  <th scope="row" className="py-3 pr-2 text-left font-medium">
                    {line.name}
                  </th>
                  <td className="px-2 py-3">
                    <div className="mx-auto flex w-fit items-center rounded-control border border-control">
                      <IconButton
                        size="sm"
                        label={t('actions.decrease', { name: line.name })}
                        onClick={() => setQuantity(line.productId, line.quantity - 1)}
                      >
                        <MinusIcon className="size-4" />
                      </IconButton>
                      <span className="min-w-8 text-center font-mono" aria-live="polite">
                        {line.quantity}
                      </span>
                      <IconButton
                        size="sm"
                        label={t('actions.increase', { name: line.name })}
                        onClick={() => setQuantity(line.productId, line.quantity + 1)}
                      >
                        <span aria-hidden className="text-body leading-none">
                          +
                        </span>
                      </IconButton>
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right">
                    <MoneyText paise={line.unitPricePaise} />
                  </td>
                  <td className="py-3 pl-2 text-right">
                    <MoneyText paise={linePreviewPaise(line)} />
                  </td>
                  <td className="py-3 text-right">
                    <IconButton
                      size="sm"
                      label={t('actions.remove', { name: line.name })}
                      onClick={() => removeItem(line.productId)}
                    >
                      <CloseIcon className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-auto border-t border-line pt-4">
          <h2 className="mb-2 text-micro font-medium tracking-wider text-muted uppercase">
            {t('quickAdd.heading')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {SAMPLE_PRODUCTS.map((product) => (
              <li key={product.productId}>
                <Button variant="secondary" onClick={() => addItem(product)}>
                  <span className="sr-only">{t('quickAdd.add', { name: product.name })}</span>
                  <span aria-hidden>{product.name.split(',')[0]}</span>
                  <MoneyText paise={product.unitPricePaise} tone="muted" trimZeroPaise />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---- Right: totals and the pay button ---- */}
      <section aria-labelledby="totals-title" className="flex flex-col gap-4 bg-side p-4 sm:p-6">
        <h2
          id="totals-title"
          className="text-micro font-medium tracking-wider text-muted uppercase"
        >
          {t('totals.heading')}
        </h2>
        <div className="flex items-baseline justify-between text-small text-muted">
          <span>{t('totals.subtotal')}</span>
          <MoneyText paise={subtotal} className="text-ink" />
        </div>
        <p aria-live="polite">
          <MoneyText paise={subtotal} size="hero" trimZeroPaise />
        </p>
        <p className="text-caption text-muted">{t('totals.previewNote')}</p>

        <div className="mt-auto flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            disabled
            title={t('totals.payDisabled')}
            className="font-display text-title font-bold tracking-wider uppercase"
          >
            {t('totals.pay')}
          </Button>
          <p className="text-caption text-muted">{t('totals.payDisabled')}</p>
          <Button variant="secondary" onClick={clear} disabled={lines.length === 0}>
            {t('actions.clear')}
          </Button>
        </div>
      </section>
    </div>
  );
}
