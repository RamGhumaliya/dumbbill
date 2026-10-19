import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BranchForm } from '@/components/business/branch-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Branches.editPage');
  return { title: t('title') };
}

/** Edit one branch. The id comes from the address; the server decides whether the person may see it. */
export default async function EditBranchPage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const t = await getTranslations('Branches.editPage');
  const { branchId } = await params;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <BranchForm branchId={branchId} />
    </div>
  );
}
