import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PurchaseForm } from '@/components/purchasing/purchase-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Purchases.new');
  return { title: t('title') };
}

/** Record a supplier bill, spreadsheet style, with a live landed-cost and average-cost preview. */
export default async function Page() {
  const t = await getTranslations('Purchases.new');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <PurchaseForm />
    </div>
  );
}
