import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PurchaseDetail } from '@/components/purchasing/purchase-detail';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Purchases');
  return { title: t('title') };
}

/** One saved purchase, read-only. The id comes from the address; the server decides whether the person may see it. */
export default async function PurchasePage({
  params,
}: {
  params: Promise<{ purchaseId: string }>;
}) {
  const t = await getTranslations('Purchases');
  const { purchaseId } = await params;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <PurchaseDetail purchaseId={purchaseId} />
    </div>
  );
}
