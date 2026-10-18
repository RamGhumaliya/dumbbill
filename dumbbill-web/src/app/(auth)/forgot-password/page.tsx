import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.forgot');
  return { title: t('title') };
}

/** Ask for a password reset link by email. */
export default async function ForgotPasswordPage() {
  const t = await getTranslations('Auth');
  return (
    <AuthShell
      title={t('forgot.title')}
      subtitle={t('forgot.subtitle')}
      footer={
        <p>
          <Link href="/login" className="text-ink underline underline-offset-4 hover:text-muted">
            {t('shell.backToSignIn')}
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
