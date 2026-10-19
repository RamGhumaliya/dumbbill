import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BranchForm } from '@/components/business/branch-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Branches.new');
  return { title: t('title') };
}

/** Add a branch. The server checks the plan's branch limit. */
export default async function NewBranchPage() {
  const t = await getTranslations('Branches.new');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <BranchForm />
    </div>
  );
}
