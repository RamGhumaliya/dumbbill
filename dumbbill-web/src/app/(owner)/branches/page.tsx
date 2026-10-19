import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BranchesScreen } from '@/components/business/branches-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Branches');
  return { title: t('title') };
}

/** The branches of the business: list, plan usage, add, edit, switch off and on. */
export default async function BranchesPage() {
  const t = await getTranslations('Branches');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <BranchesScreen />
    </div>
  );
}
