import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.verify');
  return { title: t('title') };
}

/** The page the link in the verification email opens: confirms the address, or offers a new link. */
export default async function VerifyEmailPage() {
  const t = await getTranslations('Auth');
  return (
    <AuthShell title={t('verify.title')}>
      <Suspense>
        <VerifyEmailPanel />
      </Suspense>
    </AuthShell>
  );
}
