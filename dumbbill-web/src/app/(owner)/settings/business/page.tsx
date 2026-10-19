import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BusinessProfileScreen } from '@/components/business/business-profile-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Business');
  return { title: t('title') };
}

/**
 * Business profile: name, GST state, optional GSTIN, address, phone and logo.
 * Loaded in the browser with the person's access token, behind the owner area's sign-in gate.
 */
export default async function BusinessProfilePage() {
  const t = await getTranslations('Business');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      <BusinessProfileScreen />
    </div>
  );
}
