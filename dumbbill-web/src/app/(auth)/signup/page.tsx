import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignupForm } from '@/components/auth/signup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.signup');
  return { title: t('title') };
}

/** Create a business and its owner account. */
export default async function SignupPage() {
  const t = await getTranslations('Auth');
  return (
    <AuthShell
      title={t('signup.title')}
      subtitle={t('signup.subtitle')}
      footer={
        <p>
          {t('shell.haveAccount')}{' '}
          <Link href="/login" className="text-ink underline underline-offset-4 hover:text-muted">
            {t('login.title')}
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
