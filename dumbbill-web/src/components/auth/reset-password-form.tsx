'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, buttonStyles, Field, PasswordInput } from '@/components/ui';
import { ApiError, authApi, getBrowserApiClient } from '@/lib/api';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeApiError, type AuthT, type ErrorView } from './auth-errors';

/**
 * The page behind the link in the reset email: `/reset-password?token=...`.
 *
 * The person picks a new password (typed twice, because a typo here would lock them out of their own shop). On
 * success the server ends EVERY session, so this page sends them to sign in again with a notice saying so.
 *
 * A weak password is refused by the server WITHOUT using up the link (they can fix it and resubmit); an old, used or
 * incomplete link gets a clear message and a way to request a new one.
 */
function buildSchema(t: AuthT) {
  return z
    .object({
      newPassword: z
        .string()
        .min(10, t('validation.passwordTooShort'))
        .max(128, t('validation.passwordTooLong')),
      confirmPassword: z.string().min(1, t('validation.newPasswordRequired')),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      path: ['confirmPassword'],
      message: t('validation.passwordMismatch'),
    });
}

export function ResetPasswordForm() {
  const t = useTranslations('Auth');
  const common = useTranslations('Common');
  const router = useRouter();
  const token = useSearchParams().get('token');
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, { defaultValues: { newPassword: '', confirmPassword: '' } });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  const [linkProblem, setLinkProblem] = useState(false);
  const [failure, setFailure] = useState<ErrorView | null>(null);

  if (!token || linkProblem) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="warning" title={token ? t('reset.invalidTitle') : t('reset.missingTitle')}>
          {token ? t('reset.invalidBody') : t('reset.missingBody')}
        </Alert>
        <Link href="/forgot-password" className={buttonStyles({ variant: 'primary' })}>
          {t('reset.requestNew')}
        </Link>
      </div>
    );
  }

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    setFailure(null);
    try {
      await authApi.resetPassword(getBrowserApiClient(), { token, newPassword });
      router.replace('/login?notice=password-reset');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_TOKEN') {
        setLinkProblem(true);
        return;
      }
      // The API names the field "password"; this form calls it "newPassword".
      if (!form.applyServerErrors(error, { password: 'newPassword' })) {
        setFailure(describeApiError(error, t));
      }
    }
  });

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
      <Field
        label={t('fields.newPassword')}
        hint={t('fields.passwordRule')}
        error={errors.newPassword?.message}
        required
      >
        <PasswordInput
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          autoComplete="new-password"
          {...register('newPassword')}
        />
      </Field>
      <Field label={t('fields.confirmPassword')} error={errors.confirmPassword?.message} required>
        <PasswordInput
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          autoComplete="new-password"
          {...register('confirmPassword')}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
        {isSubmitting ? t('reset.submitting') : t('reset.submit')}
      </Button>
    </form>
  );
}
