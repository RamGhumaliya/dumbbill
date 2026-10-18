'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Field, PasswordInput, useToast } from '@/components/ui';
import { ApiError, authApi, getBrowserApiClient } from '@/lib/api';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeApiError, type AuthT, type ErrorView } from '../auth-errors';

/**
 * Change the password while signed in. The current password is asked again so that a borrowed, unlocked screen
 * cannot be used to take over the account. Success signs out every OTHER device (this one stays), which the toast
 * says plainly, because it is what the owner would want to know.
 */
function buildSchema(t: AuthT) {
  return z
    .object({
      currentPassword: z.string().min(1, t('validation.passwordRequired')),
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

export function ChangePasswordForm() {
  const t = useTranslations('Auth');
  const common = useTranslations('Common');
  const { toast } = useToast();
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = form;
  const [failure, setFailure] = useState<ErrorView | null>(null);

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFailure(null);
    try {
      await authApi.changePassword(getBrowserApiClient(), { currentPassword, newPassword });
      reset();
      toast({
        title: t('security.password.done'),
        description: t('security.password.doneBody'),
        tone: 'success',
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setError('currentPassword', {
          type: 'server',
          message: t('security.password.wrongCurrent'),
        });
      } else if (!form.applyServerErrors(error, { password: 'newPassword' })) {
        setFailure(describeApiError(error, t));
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-5">
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
      <Field label={t('fields.currentPassword')} error={errors.currentPassword?.message} required>
        <PasswordInput
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          autoComplete="current-password"
          {...register('currentPassword')}
        />
      </Field>
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
      <div>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isSubmitting ? t('security.password.submitting') : t('security.password.submit')}
        </Button>
      </div>
    </form>
  );
}
