import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StockScreen } from '@/components/stock/stock-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Stock');
  return { title: t('title') };
}

/** Stock by branch: levels, the ledger drilldown, counts, alerts and transfers. */
export default async function Page() {
  const t = await getTranslations('Stock');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <StockScreen />
    </div>
  );
}
