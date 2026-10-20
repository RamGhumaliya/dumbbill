'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, CheckIcon } from '@/components/ui';
import { businessApi, getBrowserApiClient } from '@/lib/api';
import { useCan } from '@/lib/auth/use-can';

/**
 * Where each first step is done. A step without a screen yet (the team screens arrive later) has no link and says so,
 * rather than sending the owner to a page that does not exist.
 */
const STEP_LINKS: Record<
  'PROFILE' | 'BRANCH' | 'PRODUCTS' | 'SUPPLIER' | 'PURCHASE' | 'TEAM',
  string | null
> = {
  PROFILE: '/settings/business',
  BRANCH: '/branches',
  PRODUCTS: '/products',
  SUPPLIER: '/suppliers',
  PURCHASE: '/purchases/new',
  TEAM: null,
};

/**
 * The first-steps checklist on the owner's home screen (journey J1, "guided checklist").
 *
 * Each step turns done by doing the real work (the server checks the data), never by ticking a box, so the list
 * cannot lie. Only people who can manage settings see it; once every step is done it shrinks to one line.
 */
export function OnboardingChecklist() {
  const t = useTranslations('Business.onboarding');
  const canManage = useCan('settings.manage');
  const checklist = useQuery({
    queryKey: ['business', 'onboarding'],
    queryFn: () => businessApi.getOnboardingChecklist(getBrowserApiClient()),
    enabled: canManage,
  });

  if (!canManage) return null;
  if (checklist.isError) return <Alert tone="warning" title={t('loadFailed')} />;
  if (!checklist.data) return null;

  const { steps } = checklist.data;
  const done = steps.filter((step) => step.done).length;

  if (done === steps.length) {
    return (
      <p className="flex items-center gap-2 text-small text-muted" role="status">
        <CheckIcon aria-hidden className="size-4 text-success" />
        {t('allDone')}
      </p>
    );
  }

  return (
    <section aria-labelledby="onboarding-heading" className="border-t-2 border-rule pt-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="onboarding-heading" className="text-title font-semibold">
            {t('title')}
          </h2>
          <p className="mt-1 max-w-prose text-small text-muted">{t('subtitle')}</p>
        </div>
        <Badge variant="neutral">{t('progress', { done, total: steps.length })}</Badge>
      </div>
      <ol className="divide-y divide-line border-y border-line">
        {steps.map((step) => {
          const link = STEP_LINKS[step.key];
          return (
            <li key={step.key} className="flex flex-wrap items-center gap-4 py-3">
              <span
                aria-hidden
                className={
                  step.done
                    ? 'flex size-6 items-center justify-center rounded-full bg-success text-on-accent'
                    : 'size-6 rounded-full border-2 border-control'
                }
              >
                {step.done && <CheckIcon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">
                  {t(`steps.${step.key}.title`)}
                  {step.done && <span className="sr-only"> ({t('stepDone')})</span>}
                </p>
                <p className="text-small text-muted">{t(`steps.${step.key}.body`)}</p>
              </div>
              {!step.done &&
                (link ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={link}>{t(`steps.${step.key}.action`)}</Link>
                  </Button>
                ) : (
                  <Badge variant="neutral">{t('comingSoon')}</Badge>
                ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
