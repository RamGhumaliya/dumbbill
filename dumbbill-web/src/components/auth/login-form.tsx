'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';
import { ApiError, authApi, getBrowserApiClient } from '@/lib/api';
import { safeNextPath } from '@/lib/auth/redirect';
import { startSession } from '@/lib/auth/session-actions';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeApiError, type AuthT, type ErrorView } from './auth-errors';
import { useCountdown } from './use-countdown';

/**
 * The sign-in form: email and password, then (only for accounts that use an authenticator app) a second step
 * asking for the 6-digit code.
 *
 * How the two steps work: the first request carries only email and password. If the account has two-step sign-in
 * the server answers TOTP_REQUIRED (and only after the password was right), and the form swaps to the code box
 * and sends the same request again WITH the code. A person who lost their phone can type a one-time recovery
 * code instead.
 *
 * What a person can meet, and how it is handled (the wording lives in messages/en.json):
 *   wrong email or password  one generic message: never which of the two, never whether the account exists
 *   email not verified       an explanation and a button to send the link again
 *   too many attempts        a live "wait N seconds" countdown, and the button stays disabled until it ends
 *   anything unexpected      a plain message with the reference to quote to support
 *
 * After success the access token is kept in memory (the refresh token arrived as an httpOnly cookie, never in
 * this page's reach) and the person goes to the page they wanted (`?next=`, checked so it can only be a page of
 * this site).
 */
type Step = 'credentials' | 'code';

/** A message shown above the form. */
type Banner = { kind: 'unverified' } | { kind: 'resent' } | { kind: 'error'; view: ErrorView };

/** The rules for each step. Written as a function of the step so the code fields are only required when shown. */
function buildSchema(t: AuthT, step: Step, useRecovery: boolean) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t('validation.emailRequired'))
      .pipe(z.email(t('validation.emailInvalid'))),
    password: z.string().min(1, t('validation.passwordRequired')),
    totpCode:
      step === 'code' && !useRecovery
        ? z
            .string()
            .trim()
            .regex(/^\d{6}$/, t('validation.codeInvalid'))
        : z.string().optional(),
    recoveryCode:
      step === 'code' && useRecovery
        ? z.string().trim().min(1, t('validation.recoveryRequired'))
        : z.string().optional(),
  });
}

/**
 * Notices carried in the address, for example after a password reset: `/login?notice=password-reset`.
 * Only these four values are recognised, so nobody can make the page print text of their own choosing.
 */
const NOTICE_KEYS = {
  'password-reset': 'login.notice.passwordReset',
  'signed-out': 'login.notice.signedOut',
  verified: 'login.notice.verified',
  'invitation-accepted': 'login.notice.invitationAccepted',
} as const;

export function LoginForm() {
  const t = useTranslations('Auth');
  const common = useTranslations('Common');
  const brand = useTranslations('Brand')('name');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('credentials');
  const [useRecovery, setUseRecovery] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const wait = useCountdown();

  const schema = useMemo(() => buildSchema(t, step, useRecovery), [t, step, useRecovery]);
  const form = useApiForm(schema, {
    defaultValues: { email: '', password: '', totpCode: '', recoveryCode: '' },
  });
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    getValues,
    formState: { errors, isSubmitting },
  } = form;

  // Put the cursor in the code box as soon as it appears (and when switching between code and recovery code).
  // This must run AFTER the new field has been drawn, which is why it is an effect and not part of the handler.
  useEffect(() => {
    if (step === 'code') setFocus(useRecovery ? 'recoveryCode' : 'totpCode');
  }, [step, useRecovery, setFocus]);

  const noticeParam = searchParams.get('notice');
  const noticeKey =
    noticeParam && noticeParam in NOTICE_KEYS
      ? NOTICE_KEYS[noticeParam as keyof typeof NOTICE_KEYS]
      : undefined;
  const client = getBrowserApiClient();

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    try {
      const result = await authApi.logIn(client, {
        email: values.email,
        password: values.password,
        ...(step === 'code'
          ? useRecovery
            ? { recoveryCode: values.recoveryCode }
            : { totpCode: values.totpCode }
          : {}),
      });
      startSession(result);
      router.replace(safeNextPath(searchParams.get('next')));
    } catch (error) {
      handleFailure(error);
    }
  });

  /** Decide what a failed sign-in means for the screen. */
  function handleFailure(error: unknown): void {
    if (error instanceof ApiError) {
      switch (error.code) {
        case 'TOTP_REQUIRED':
          // The password was right. Ask for the code (the effect below puts the cursor in the box).
          setStep('code');
          return;
        case 'INVALID_TOTP_CODE':
          setError(useRecovery ? 'recoveryCode' : 'totpCode', {
            type: 'server',
            message: t('errors.invalidTotp'),
          });
          return;
        case 'EMAIL_NOT_VERIFIED':
          setBanner({ kind: 'unverified' });
          return;
        case 'RATE_LIMITED':
          if (error.retryAfterSeconds) wait.start(error.retryAfterSeconds);
          setBanner({ kind: 'error', view: describeApiError(error, t) });
          return;
      }
    }
    setBanner({ kind: 'error', view: describeApiError(error, t) });
  }

  const [resending, setResending] = useState(false);
  async function resend(): Promise<void> {
    setResending(true);
    try {
      await authApi.resendVerificationEmail(client, getValues('email').trim());
      setBanner({ kind: 'resent' });
    } catch (error) {
      setBanner({ kind: 'error', view: describeApiError(error, t) });
    } finally {
      setResending(false);
    }
  }

  const locked = wait.secondsLeft > 0;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {noticeKey && step === 'credentials' && <Alert tone="success" title={t(noticeKey)} />}

      {banner?.kind === 'error' && (
        <Alert tone="danger" title={banner.view.title}>
          {locked ? t('errors.locked', { seconds: wait.secondsLeft }) : banner.view.body}
          {banner.view.reference && (
            <span className="mt-1 block font-mono text-caption">
              {common('reference', { code: banner.view.reference })}
            </span>
          )}
        </Alert>
      )}
      {banner?.kind === 'unverified' && (
        <Alert tone="warning" title={t('login.unverified.title')}>
          <p>{t('login.unverified.body')}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            loading={resending}
            onClick={resend}
          >
            {resending ? t('login.unverified.resending') : t('login.unverified.resend')}
          </Button>
        </Alert>
      )}
      {banner?.kind === 'resent' && <Alert tone="info" title={t('login.unverified.resent')} />}

      {step === 'credentials' ? (
        <>
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
          <Field label={t('fields.password')} error={errors.password?.message} required>
            <PasswordInput
              showLabel={t('fields.showPassword')}
              hideLabel={t('fields.hidePassword')}
              autoComplete="current-password"
              {...register('password')}
            />
          </Field>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-title font-medium">{t('login.totp.title')}</h2>
            <p className="mt-1 text-small text-muted">{t('login.totp.hint', { brand })}</p>
          </div>
          {useRecovery ? (
            <Field
              label={t('login.totp.recoveryCode')}
              hint={t('login.totp.recoveryHint')}
              error={errors.recoveryCode?.message}
              required
            >
              <Input
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono tracking-wider"
                {...register('recoveryCode')}
              />
            </Field>
          ) : (
            <Field label={t('login.totp.code')} error={errors.totpCode?.message} required>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="font-mono text-title tracking-widest"
                {...register('totpCode')}
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-small">
            <button
              type="button"
              className="text-ink underline underline-offset-4 hover:text-muted"
              onClick={() => {
                setUseRecovery((current) => !current);
                setBanner(null);
              }}
            >
              {useRecovery ? t('login.totp.useApp') : t('login.totp.useRecovery')}
            </button>
            <button
              type="button"
              className="text-muted underline underline-offset-4 hover:text-ink"
              onClick={() => {
                setStep('credentials');
                setUseRecovery(false);
                setBanner(null);
              }}
            >
              {t('login.totp.back')}
            </button>
          </div>
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" loading={isSubmitting} disabled={locked}>
        {isSubmitting
          ? t('login.submitting')
          : step === 'code'
            ? t('login.totp.submit')
            : t('login.submit')}
      </Button>

      {step === 'credentials' && (
        <Link
          href="/forgot-password"
          className="text-small text-ink underline underline-offset-4 hover:text-muted"
        >
          {t('login.forgot')}
        </Link>
      )}
    </form>
  );
}
