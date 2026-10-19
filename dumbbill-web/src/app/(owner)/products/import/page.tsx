import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProductImportScreen } from '@/components/products/product-import-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Products.importPage');
  return { title: t('title') };
}

/** Add many products at once from a CSV file, with a row-by-row report of anything that needs fixing. */
export default async function ImportProductsPage() {
  const t = await getTranslations('Products.importPage');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <ProductImportScreen />
    </div>
  );
}
