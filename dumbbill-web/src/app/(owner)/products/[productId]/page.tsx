import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProductForm } from '@/components/products/product-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Products.form');
  return { title: t('editTitle') };
}

/** Edit one product, change its price, and manage its picture. The id comes from the address; the server decides if it may be seen. */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const t = await getTranslations('Products.form');
  const { productId } = await params;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('editTitle')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('editSubtitle')}</p>
      </div>
      <ProductForm productId={productId} />
    </div>
  );
}
