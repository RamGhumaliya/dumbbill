import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AcceptInvitationForm } from '@/components/auth/accept-invitation-form';
import { AuthShell } from '@/components/auth/auth-shell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.invite');
  return { title: t('title') };
}

/** The page the link in a team invitation email opens: the invited person chooses their password. */
export default async function AcceptInvitationPage() {
  const t = await getTranslations('Auth');
  return (
    <AuthShell
      title={t('invite.title')}
      subtitle={t('invite.subtitle')}
      footer={
        <p>
          <Link href="/login" className="text-ink underline underline-offset-4 hover:text-muted">
            {t('invite.signIn')}
          </Link>
        </p>
      }
    >
      <Suspense>
        <AcceptInvitationForm />
      </Suspense>
    </AuthShell>
  );
}
