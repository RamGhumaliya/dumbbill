import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.reset');
  return { title: t('title') };
}

/** The page the link in the reset email opens: choose a new password. */
export default async function ResetPasswordPage() {
  const t = await getTranslations('Auth');
  return (
    <AuthShell title={t('reset.title')} subtitle={t('reset.subtitle')}>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
