import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ChangePasswordForm } from '@/components/auth/security/change-password-form';
import { DevicesList } from '@/components/auth/security/devices-list';
import { TwoStepCard } from '@/components/auth/security/two-step-card';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.security');
  return { title: t('title') };
}

/**
 * Account security: change password, two-step sign-in, and the devices that are signed in.
 * Everything here is loaded in the browser with the person's access token (the server cannot know who is asking
 * when it renders a page), and sits behind the sign-in gate of the owner area.
 */
export default async function AccountSecurityPage() {
  const t = await getTranslations('Auth.security');
  const sections = [
    {
      id: 'password',
      heading: t('password.heading'),
      hint: t('password.hint'),
      body: <ChangePasswordForm />,
    },
    { id: 'two-step', heading: t('totp.heading'), hint: undefined, body: <TwoStepCard /> },
    {
      id: 'devices',
      heading: t('devices.heading'),
      hint: t('devices.hint'),
      body: <DevicesList />,
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">{t('subtitle')}</p>
      </div>
      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`${section.id}-heading`}
          className="flex flex-col gap-4 border-t-2 border-rule pt-4"
        >
          <div>
            <h2 id={`${section.id}-heading`} className="text-title font-semibold">
              {section.heading}
            </h2>
            {section.hint && <p className="mt-1 text-small text-muted">{section.hint}</p>}
          </div>
          {section.body}
        </section>
      ))}
    </div>
  );
}
