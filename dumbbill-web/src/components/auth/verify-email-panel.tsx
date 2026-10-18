'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, buttonStyles, Field, Input } from '@/components/ui';
import { ApiError, authApi, getBrowserApiClient } from '@/lib/api';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeApiError } from './auth-errors';

/**
 * The page behind the link in the verification email: `/verify-email?token=...`.
 *
 * It confirms the address automatically when it opens. Two details matter:
 *  - The token works ONCE. React in development runs effects twice, and a second call would burn the link and show
 *    a false "expired" message, so a ref remembers that the call was already made.
 *  - If the link is old, used, or incomplete the page does not just say "error": it offers to send a new link right
 *    here (the person only needs to type their email).
 */
type State = 'checking' | 'confirmed' | 'failed' | 'missing';

export function VerifyEmailPanel() {
  const t = useTranslations('Auth');
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(token ? 'checking' : 'missing');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    authApi
      .verifyEmail(getBrowserApiClient(), token)
      .then(() => setState('confirmed'))
      .catch(() => setState('failed'));
  }, [token]);

  if (state === 'checking') {
    return (
      <p role="status" className="text-body text-muted">
        {t('verify.checking')}
      </p>
    );
  }

  if (state === 'confirmed') {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={t('verify.successTitle')}>
          {t('verify.successBody')}
        </Alert>
        <Link
          href="/login?notice=verified"
          className={buttonStyles({ variant: 'primary', size: 'lg' })}
        >
          {t('verify.signIn')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Alert
        tone="warning"
        title={state === 'failed' ? t('verify.failedTitle') : t('verify.missingTitle')}
      >
        {state === 'failed' ? t('verify.failedBody') : t('verify.missingBody')}
      </Alert>
      <ResendForm />
    </div>
  );
}

/** Ask for a new verification link by typing the email address. The answer is always the same sentence. */
function ResendForm() {
  const t = useTranslations('Auth');
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useApiForm(
    z.object({
      email: z
        .string()
        .trim()
        .min(1, t('validation.emailRequired'))
        .pipe(z.email(t('validation.emailInvalid'))),
    }),
    { defaultValues: { email: '' } },
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async ({ email }) => {
    setFailure(null);
    try {
      await authApi.resendVerificationEmail(getBrowserApiClient(), email);
      setSent(true);
    } catch (error) {
      setFailure(describeApiError(error, t).body);
      if (error instanceof ApiError && error.code === 'RATE_LIMITED') setSent(false);
    }
  });

  if (sent) return <Alert tone="info" title={t('verify.resent')} />;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {failure && (
        <Alert tone="danger" title={t('errors.problemTitle')}>
          {failure}
        </Alert>
      )}
      <Field label={t('fields.email')} error={errors.email?.message} required>
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          {...register('email')}
        />
      </Field>
      <Button type="submit" variant="secondary" loading={isSubmitting}>
        {isSubmitting ? t('verify.resending') : t('verify.resend')}
      </Button>
    </form>
  );
}
