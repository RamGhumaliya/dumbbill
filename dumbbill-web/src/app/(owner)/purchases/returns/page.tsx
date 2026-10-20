import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReturnsScreen } from '@/components/purchasing/returns-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Purchases.returnsPage');
  return { title: t('title') };
}

/** The debit notes: goods sent back to suppliers. */
export default async function Page() {
  const t = await getTranslations('Purchases.returnsPage');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <ReturnsScreen />
    </div>
  );
}
