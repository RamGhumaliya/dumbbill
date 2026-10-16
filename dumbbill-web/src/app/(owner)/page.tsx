import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ServerStatus } from '@/components/owner/server-status';
import { Badge, MoneyText } from '@/components/ui';

/*
 * SAMPLE figures that exist only to show the layout of the future dashboard. They are labelled
 * "sample" on screen and are replaced by real report data in Phase 3. Money is in paise.
 */
const SAMPLE = {
  salesPaise: 18_426_000, // Rs 1,84,260.00
  bills: 61,
  profitPaise: 3_890_000, // Rs 38,900.00
  lowStock: 7,
} as const;

/** The owner's home screen. For now: a status check of the server and a preview of the dashboard layout. */
export default async function OwnerHomePage() {
  const t = await getTranslations('Owner');

  const kpis = [
    {
      label: t('sample.sales'),
      value: <MoneyText paise={SAMPLE.salesPaise} size="total" trimZeroPaise />,
    },
    {
      label: t('sample.bills'),
      value: <span className="font-display text-heading font-semibold">{SAMPLE.bills}</span>,
    },
    {
      label: t('sample.profit'),
      value: <MoneyText paise={SAMPLE.profitPaise} size="total" trimZeroPaise />,
    },
    {
      label: t('sample.lowStock'),
      value: <span className="font-display text-heading font-semibold">{SAMPLE.lowStock}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>

      <section aria-labelledby="sample-heading">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2
            id="sample-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('sample.heading')}
          </h2>
          <Badge variant="warning">{t('sample.notice')}</Badge>
        </div>
        <dl className="grid grid-cols-2 border-t-2 border-rule lg:grid-cols-4">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="border-b border-line py-4 pr-4 lg:border-r lg:pl-4 lg:first:pl-0 lg:last:border-r-0"
            >
              <dt className="text-caption text-muted">{kpi.label}</dt>
              <dd className="mt-1">{kpi.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="status-heading">
        <h2
          id="status-heading"
          className="mb-3 text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('status.heading')}
        </h2>
        <Suspense fallback={<p className="text-small text-muted">{t('status.checking')}</p>}>
          <ServerStatus />
        </Suspense>
      </section>
    </div>
  );
}
