import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui';

/** Shown for any address that does not exist (or that the person may not see). */
export default async function NotFound() {
  const t = await getTranslations('Errors');

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6">
      <p className="font-display text-hero leading-none font-bold text-muted">404</p>
      <h1 className="font-display text-display font-bold tracking-wide uppercase">
        {t('notFoundTitle')}
      </h1>
      <p className="text-body text-muted">{t('notFoundBody')}</p>
      <div>
        <Button asChild variant="primary">
          <Link href="/">{t('goHome')}</Link>
        </Button>
      </div>
    </main>
  );
}
