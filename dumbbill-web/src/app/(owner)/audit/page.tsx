import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditScreen } from '@/components/audit/audit-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Audit');
  return { title: t('title') };
}

/** The audit log viewer with filters and the tamper check. */
export default async function Page() {
  const t = await getTranslations('Audit');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <AuditScreen />
    </div>
  );
}
