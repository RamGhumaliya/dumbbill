import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.login');
  return { title: t('title') };
}

/** Sign in. The form reads `?next=` (where to go afterwards) and `?notice=` (for example after a password reset). */
export default async function LoginPage() {
  const t = await getTranslations('Auth');
  const brand = (await getTranslations('Brand'))('name');
  return (
    <AuthShell
      title={t('login.title')}
      subtitle={t('login.subtitle')}
      footer={
        <p>
          {t('shell.newHere', { brand })}{' '}
          <Link href="/signup" className="text-ink underline underline-offset-4 hover:text-muted">
            {t('login.createAccount')}
          </Link>
        </p>
      }
    >
      {/* The form reads the address (useSearchParams), which Next.js wants inside a Suspense boundary. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
