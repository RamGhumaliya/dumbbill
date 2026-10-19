'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Field, PasswordInput } from '@/components/ui';
import { ApiError, authApi, getBrowserApiClient } from '@/lib/api';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeApiError, type AuthT, type ErrorView } from './auth-errors';

/**
 * The page behind the link in a team invitation email: `/accept-invitation?token=...`.
 *
 * The invited person chooses their OWN password (typed twice); nobody else ever sees or sets it. Opening the link also
 * proves they own the address, so no separate confirmation email is needed. Afterwards they go to the sign-in page.
 *
 * A refused password (too short, too common, found in a data breach) is explained under the password box and does NOT
 * use up the link. An old, used, or incomplete link gets a clear message telling them to ask for a new invitation: the
 * person who invited them can send another from the team screen.
 */
function buildSchema(t: AuthT) {
  return z
    .object({
      password: z
        .string()
        .min(10, t('validation.passwordTooShort'))
        .max(128, t('validation.passwordTooLong')),
      confirmPassword: z.string().min(1, t('validation.newPasswordRequired')),
    })
    .refine((values) => values.password === values.confirmPassword, {
      path: ['confirmPassword'],
      message: t('validation.passwordMismatch'),
    });
}

export function AcceptInvitationForm() {
  const t = useTranslations('Auth');
  const common = useTranslations('Common');
  const router = useRouter();
  const token = useSearchParams().get('token');
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, { defaultValues: { password: '', confirmPassword: '' } });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  const [linkProblem, setLinkProblem] = useState(false);
  const [failure, setFailure] = useState<ErrorView | null>(null);

  if (!token || linkProblem) {
    return (
      <Alert tone="warning" title={token ? t('invite.invalidTitle') : t('invite.missingTitle')}>
        {token ? t('invite.invalidBody') : t('invite.missingBody')}
      </Alert>
    );
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    setFailure(null);
    try {
      await authApi.acceptInvitation(getBrowserApiClient(), { token, password });
      router.replace('/login?notice=invitation-accepted');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_TOKEN') {
        setLinkProblem(true);
        return;
      }
      // A refused password lands under the password box; anything else becomes a message with a reference.
      if (!form.applyServerErrors(error)) setFailure(describeApiError(error, t));
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
        label={t('fields.password')}
        hint={t('fields.passwordRule')}
        error={errors.password?.message}
        required
      >
        <PasswordInput
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          autoComplete="new-password"
          {...register('password')}
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
        {isSubmitting ? t('invite.submitting') : t('invite.submit')}
      </Button>
    </form>
  );
}
