'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';
import { authApi, getBrowserApiClient } from '@/lib/api';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeApiError, type AuthT, type ErrorView } from './auth-errors';

/**
 * Create a business and its owner account.
 *
 * The password rules are checked in the browser first (so the person is not made to wait for a round trip), but the
 * server applies them again and ALSO refuses passwords that are very common or found in data breaches. Those
 * reasons come back as field errors and appear under the password box.
 *
 * THE ANSWER IS ALWAYS THE SAME. The server says "a message is on its way" whether or not the email already has an
 * account (otherwise this page could be used to find out who uses the product). So the confirmation here must not,
 * and cannot, say "that email is already registered": it says "if this address can be used, we sent a link". The
 * real owner of an existing address gets a different email explaining that.
 */
function buildSchema(t: AuthT) {
  return z.object({
    businessName: z.string().trim().min(1, t('validation.businessNameRequired')).max(100),
    ownerName: z.string().trim().min(1, t('validation.ownerNameRequired')).max(100),
    email: z
      .string()
      .trim()
      .min(1, t('validation.emailRequired'))
      .pipe(z.email(t('validation.emailInvalid'))),
    password: z
      .string()
      .min(10, t('validation.passwordTooShort'))
      .max(128, t('validation.passwordTooLong')),
  });
}

export function SignupForm() {
  const t = useTranslations('Auth');
  const common = useTranslations('Common');
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: { businessName: '', ownerName: '', email: '', password: '' },
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failure, setFailure] = useState<ErrorView | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await authApi.signUp(getBrowserApiClient(), values);
      setSentTo(values.email);
    } catch (error) {
      // Field-level problems (a refused password) go under their field; anything else becomes a message.
      if (!form.applyServerErrors(error)) setFailure(describeApiError(error, t));
    }
  });

  if (sentTo) {
    return (
      <section aria-labelledby="sent-title" className="flex flex-col gap-4">
        <Alert tone="info" title={t('signup.sent.title')}>
          <p id="sent-title">{t('signup.sent.body', { email: sentTo })}</p>
          <p className="mt-2">{t('signup.sent.spam')}</p>
        </Alert>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            reset();
            setSentTo(null);
          }}
        >
          {t('signup.sent.again')}
        </Button>
      </section>
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
      <Field label={t('fields.businessName')} error={errors.businessName?.message} required>
        <Input autoComplete="organization" {...register('businessName')} />
      </Field>
      <Field label={t('fields.ownerName')} error={errors.ownerName?.message} required>
        <Input autoComplete="name" {...register('ownerName')} />
      </Field>
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
      <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
        {isSubmitting ? t('signup.submitting') : t('signup.submit')}
      </Button>
      <p className="text-caption text-muted">{t('signup.terms')}</p>
    </form>
  );
}
