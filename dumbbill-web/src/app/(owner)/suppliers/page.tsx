import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SuppliersScreen } from '@/components/purchasing/suppliers-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Suppliers');
  return { title: t('title') };
}

/** The suppliers the shop buys from, with what is owed to each. */
export default async function Page() {
  const t = await getTranslations('Suppliers');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <SuppliersScreen />
    </div>
  );
}
