import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TeamScreen } from '@/components/team/team-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Team');
  return { title: t('title') };
}

/** The people who work in the shop, their roles, and what each may do. */
export default async function Page() {
  const t = await getTranslations('Team');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <TeamScreen />
    </div>
  );
}
