import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Admin');
  return { title: t('title') };
}

/** Super Admin home (/admin): placeholder with an honest empty state until retailer management is built (Phase 4). */
export default async function AdminPage() {
  const t = await getTranslations('Admin');

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>

      <section aria-labelledby="retailers-heading">
        <h2
          id="retailers-heading"
          className="mb-3 text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('retailers.heading')}
        </h2>
        <EmptyState
          title={t('retailers.empty')}
          description={t('retailers.emptyHint')}
          headingLevel={3}
        />
      </section>
    </div>
  );
}
