import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProductForm } from '@/components/products/product-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Products.form');
  return { title: t('newTitle') };
}

/** Add a product with its first price. */
export default async function NewProductPage() {
  const t = await getTranslations('Products.form');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('newTitle')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('newSubtitle')}</p>
      </div>
      <ProductForm />
    </div>
  );
}
