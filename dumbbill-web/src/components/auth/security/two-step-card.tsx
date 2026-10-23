'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Field, Input, PasswordInput, QrCode, useToast } from '@/components/ui';
import { ApiError, authApi, getBrowserApiClient } from '@/lib/api';
import { useApiForm } from '@/lib/forms/use-api-form';
import { useSession } from '@/stores/session';
import { describeApiError, type AuthT } from '../auth-errors';

/**
 * Two-step sign-in with an authenticator app, switched on and off from here.
 *
 * Switching it ON is two steps, so nobody can lock themselves out with a mistyped key:
 *   1. Start: the server makes a secret and we show it as a setup key. Nothing is switched on yet.
 *   2. Confirm: the person types the first 6-digit code from their app. Only then is it on, and the server hands
 *      over one-time RECOVERY CODES. Those are shown once, here, and the person must say they have saved them.
 * Switching it OFF needs the password AND a current code, so a borrowed screen cannot remove the protection.
 *
 * The setup is offered two ways: a QR code to scan and the same key as text to type (for a person on the phone that
 * holds the app). Both are drawn in the browser; the secret is only ever held in this component's memory while the card
 * is open. Switching ON also asks for the account password, so a borrowed or stolen session cannot lock the owner out.
 */
type Phase =
  | { name: 'idle' }
  | { name: 'setup'; setup: { secret: string; otpAuthUri: string } }
  | { name: 'recovery'; codes: string[] };

export function TwoStepCard() {
  const t = useTranslations('Auth');
  const enabled = useSession((state) => state.user?.totpEnabled ?? false);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });

  return (
    <div className="flex max-w-md flex-col gap-4">
      {phase.name === 'recovery' ? (
        <RecoveryCodes codes={phase.codes} onDone={() => setPhase({ name: 'idle' })} />
      ) : enabled ? (
        <>
          <p className="text-small text-muted">{t('security.totp.onBody')}</p>
          <DisableForm />
        </>
      ) : phase.name === 'setup' ? (
        <ConfirmForm
          setup={phase.setup}
          onCancel={() => setPhase({ name: 'idle' })}
          onEnabled={(codes) => setPhase({ name: 'recovery', codes })}
        />
      ) : (
        <>
          <p className="text-small text-muted">{t('security.totp.offBody')}</p>
          <StartButton onStarted={(setup) => setPhase({ name: 'setup', setup })} />
        </>
      )}
    </div>
  );
}

/** Ask the server for a new secret. */
function StartButton({
  onStarted,
}: {
  onStarted: (setup: { secret: string; otpAuthUri: string }) => void;
}) {
  const t = useTranslations('Auth');
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const setup = await authApi.startTotpSetup(getBrowserApiClient());
            onStarted(setup);
          } catch (error) {
            const view = describeApiError(error, t);
            toast({ title: view.title, description: view.body, tone: 'danger' });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t('security.totp.starting') : t('security.totp.start')}
      </Button>
    </div>
  );
}

/** Show the QR code and the setup key, and ask for the password and the first code. */
function ConfirmForm({
  setup,
  onCancel,
  onEnabled,
}: {
  setup: { secret: string; otpAuthUri: string };
  onCancel: () => void;
  onEnabled: (recoveryCodes: string[]) => void;
}) {
  const t = useTranslations('Auth');
  const schema = useMemo(
    () =>
      z.object({
        currentPassword: z.string().min(1, t('validation.passwordRequired')),
        code: z
          .string()
          .trim()
          .regex(/^\d{6}$/, t('validation.codeInvalid')),
      }),
    [t],
  );
  const form = useApiForm(schema, { defaultValues: { currentPassword: '', code: '' } });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await authApi.enableTotp(getBrowserApiClient(), values);
      useSession.getState().updateUser({ totpEnabled: true });
      onEnabled(result.recoveryCodes);
    } catch (error) {
      // A wrong password and a wrong code are different problems; the server code says which.
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setError('currentPassword', {
          type: 'server',
          message: t('security.password.wrongCurrent'),
        });
      } else {
        setError('code', { type: 'server', message: describeApiError(error, t).body });
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-small">{t('security.totp.step1')}</p>
      <QrCode value={setup.otpAuthUri} label={t('security.totp.qrLabel')} />
      <div>
        <p className="text-caption font-medium text-muted">{t('security.totp.secretLabel')}</p>
        {/* Grouped in fours so it is easy to read aloud and type. `select-all` makes one click select the whole key. */}
        <p className="mt-1 rounded-control border border-line bg-side px-3 py-2 font-mono text-body tracking-wider break-all select-all">
          {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
        </p>
      </div>
      <p className="text-small">{t('security.totp.step2')}</p>
      <Field
        label={t('security.totp.enablePassword')}
        error={errors.currentPassword?.message}
        required
      >
        <PasswordInput
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          autoComplete="current-password"
          {...register('currentPassword')}
        />
      </Field>
      <Field label={t('security.totp.code')} error={errors.code?.message} required>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="font-mono text-title tracking-widest"
          {...register('code')}
        />
      </Field>
      <div className="flex gap-3">
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isSubmitting ? t('security.totp.enabling') : t('security.totp.enable')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('security.totp.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The one-time recovery codes. Shown once; the person must confirm they have kept them. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('Auth');
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning" title={t('security.totp.recoveryTitle')}>
        {t('security.totp.recoveryBody')}
      </Alert>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-control border border-line bg-side px-4 py-3 font-mono text-body tracking-wider select-all">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div>
        <Button variant="primary" onClick={onDone}>
          {t('security.totp.recoveryDone')}
        </Button>
      </div>
    </div>
  );
}

/** Switch two-step sign-in off. Needs the password and a current (or recovery) code. */
function DisableForm() {
  const t = useTranslations('Auth');
  const { toast } = useToast();
  const schema = useMemo(() => buildDisableSchema(t), [t]);
  const form = useApiForm(schema, { defaultValues: { password: '', code: '' } });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await authApi.disableTotp(getBrowserApiClient(), values);
      useSession.getState().updateUser({ totpEnabled: false });
      reset();
      toast({ title: t('security.totp.disabled'), tone: 'success' });
    } catch (error) {
      // A wrong password and a wrong code are different problems; the server code says which.
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setError('password', { type: 'server', message: t('security.password.wrongCurrent') });
      } else if (error instanceof ApiError && error.code === 'INVALID_TOTP_CODE') {
        setError('code', { type: 'server', message: t('errors.invalidTotp') });
      } else {
        setError('password', { type: 'server', message: describeApiError(error, t).body });
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 border-t border-line pt-4">
      <div>
        <h3 className="text-body font-medium">{t('security.totp.disableHeading')}</h3>
        <p className="mt-1 text-small text-muted">{t('security.totp.disableBody')}</p>
      </div>
      <Field label={t('security.totp.disablePassword')} error={errors.password?.message} required>
        <PasswordInput
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          autoComplete="current-password"
          {...register('password')}
        />
      </Field>
      <Field label={t('security.totp.disableCode')} error={errors.code?.message} required>
        <Input
          autoComplete="one-time-code"
          spellCheck={false}
          className="font-mono"
          {...register('code')}
        />
      </Field>
      <div>
        <Button type="submit" variant="danger" loading={isSubmitting}>
          {isSubmitting ? t('security.totp.disabling') : t('security.totp.disable')}
        </Button>
      </div>
    </form>
  );
}

function buildDisableSchema(t: AuthT) {
  return z.object({
    password: z.string().min(1, t('validation.passwordRequired')),
    code: z.string().trim().min(6, t('validation.recoveryRequired')),
  });
}
