'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, buttonStyles, Field, Input } from '@/components/ui';
import { authApi, getBrowserApiClient } from '@/lib/api';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeApiError, type ErrorView } from './auth-errors';

/**
 * "I forgot my password": the person types their email and we send a reset link.
 *
 * The confirmation never says whether the address has an account ("If ... has an account, a link is on its way"),
 * because the server answers identically either way. Saying more would let anyone test which emails are registered.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('Auth');
  const common = useTranslations('Common');
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, t('validation.emailRequired'))
          .pipe(z.email(t('validation.emailInvalid'))),
      }),
    [t],
  );
  const form = useApiForm(schema, { defaultValues: { email: '' } });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failure, setFailure] = useState<ErrorView | null>(null);

  const onSubmit = handleSubmit(async ({ email }) => {
    setFailure(null);
    try {
      await authApi.requestPasswordReset(getBrowserApiClient(), email);
      setSentTo(email);
    } catch (error) {
      setFailure(describeApiError(error, t));
    }
  });

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" title={t('forgot.sentTitle')}>
          {t('forgot.sentBody', { email: sentTo })}
        </Alert>
        <Link href="/login" className={buttonStyles({ variant: 'secondary' })}>
          {t('forgot.back')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
          {failure.reference && (
            <span className="mt-1 block font-mono text-caption">
              {common('reference', { code: failure.reference })}
            </span>
          )}
        </Alert>
      )}
      <Field label={t('fields.email')} error={errors.email?.message} required>
        <Input
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          {...register('email')}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
        {isSubmitting ? t('forgot.submitting') : t('forgot.submit')}
      </Button>
    </form>
  );
}
