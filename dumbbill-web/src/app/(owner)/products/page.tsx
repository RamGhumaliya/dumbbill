import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProductsScreen } from '@/components/products/products-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Products');
  return { title: t('title') };
}

/** The product catalogue: search, filters, a column picker and prices that can be changed from the keyboard. */
export default async function ProductsPage() {
  const t = await getTranslations('Products');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <ProductsScreen />
    </div>
  );
}
