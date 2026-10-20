import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReturnForm } from '@/components/purchasing/return-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Purchases.returnForm');
  return { title: t('title') };
}

/** Send goods back to a supplier and create a numbered debit note. */
export default async function Page() {
  const t = await getTranslations('Purchases.returnForm');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <ReturnForm />
    </div>
  );
}
