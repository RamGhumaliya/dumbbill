'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Field, Input, Skeleton, useToast } from '@/components/ui';
import { ApiError, businessApi, getBrowserApiClient } from '@/lib/api';
import type { BusinessProfile, GstState } from '@/lib/api/schemas/business';
import { useCan } from '@/lib/auth/use-can';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeFailure, type FailureView } from './business-errors';
import { LogoField } from './logo-field';
import { blankToNull, PlaceFields, placeDefaults, placeShape } from './place';

type BusinessT = ReturnType<typeof useTranslations<'Business'>>;

/**
 * The business profile screen (journey J1, step 2): name, GST state, optional GSTIN, address, phone and logo.
 *
 * Everyone signed in can read it (the till prints these details); only people with `settings.manage` can change it.
 * Without that permission every box is disabled and a line says why, so nobody types something that cannot be saved.
 * A missing GSTIN is allowed, with a plain warning that only bills of supply can then be issued.
 */
export function BusinessProfileScreen() {
  const t = useTranslations('Business');
  const profile = useQuery({
    queryKey: ['business', 'profile'],
    queryFn: () => businessApi.getBusinessProfile(getBrowserApiClient()),
  });
  const states = useQuery({
    queryKey: ['business', 'gst-states'],
    queryFn: () => businessApi.listGstStates(getBrowserApiClient()),
    // The list of states never changes while the app is open.
    staleTime: Infinity,
  });

  if (profile.isPending || states.isPending) {
    return (
      <div role="status" aria-label={t('loading')} className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full max-w-prose" />
        <Skeleton className="h-10 w-full max-w-prose" />
        <Skeleton className="h-10 w-full max-w-prose" />
      </div>
    );
  }
  if (profile.isError || states.isError) {
    return (
      <Alert tone="danger" title={t('loadFailed')}>
        <Button variant="secondary" size="sm" onClick={() => void profile.refetch()}>
          {t('errors.title')}
        </Button>
      </Alert>
    );
  }
  return <ProfileForm profile={profile.data} states={states.data} />;
}

function buildSchema(t: BusinessT) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(2, t('validation.nameRequired'))
      .max(120, t('validation.nameTooLong')),
    ...placeShape({
      stateRequired: t('validation.stateRequired'),
      gstinShape: t('validation.gstinShape'),
      pincode: t('validation.pincode'),
      phone: t('validation.phone'),
      addressTooLong: t('validation.addressTooLong'),
      cityTooLong: t('validation.cityTooLong'),
    }),
  });
}

function ProfileForm({ profile, states }: { profile: BusinessProfile; states: GstState[] }) {
  const t = useTranslations('Business');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = useCan('settings.manage');
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: { name: profile.name, ...placeDefaults(profile) },
  });
  const [failure, setFailure] = useState<FailureView | null>(null);

  const save = useMutation({
    mutationFn: (values: z.output<typeof schema>) =>
      businessApi.updateBusinessProfile(getBrowserApiClient(), {
        name: values.name,
        stateCode: values.stateCode,
        gstin: blankToNull(values.gstin),
        addressLine: blankToNull(values.addressLine),
        city: blankToNull(values.city),
        pincode: blankToNull(values.pincode),
        phone: blankToNull(values.phone),
      }),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const saved = await save.mutateAsync(values);
      // Show the cleaned-up values the server stored (for example a GSTIN typed in lower case).
      form.reset({ name: saved.name, ...placeDefaults(saved) });
      await queryClient.invalidateQueries({ queryKey: ['business'] });
      toast({ title: t('saved'), tone: 'success' });
    } catch (error) {
      if (form.applyServerErrors(error)) return;
      if (error instanceof ApiError && error.code === 'BUSINESS_RULE_VIOLATION') {
        setFailure({
          title: t('errors.title'),
          body: t('errors.ruleViolation', { detail: error.detail ?? '' }),
        });
        return;
      }
      setFailure(
        describeFailure(error, {
          title: t('errors.title'),
          network: t('errors.network'),
          forbidden: t('errors.forbidden'),
          generic: t('errors.generic'),
        }),
      );
    }
  });

  const gstinTyped = form.watch('gstin').trim() !== '';

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} noValidate className="flex max-w-prose flex-col gap-8">
        {!canEdit && <Alert tone="info" title={t('readOnly')} />}
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
            {failure.reference && (
              <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
            )}
          </Alert>
        )}

        <section aria-labelledby="identity-heading" className="flex flex-col gap-5">
          <h2
            id="identity-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('sections.identity')}
          </h2>
          <Field
            label={t('fields.name')}
            hint={t('fields.nameHint')}
            error={form.formState.errors.name?.message}
            required
          >
            <Input {...form.register('name')} disabled={!canEdit} autoComplete="organization" />
          </Field>
        </section>

        <section aria-labelledby="place-heading" className="flex flex-col gap-5">
          <h2
            id="place-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('sections.place')}
          </h2>
          <PlaceFields
            states={states}
            disabled={!canEdit}
            labels={{
              stateCode: t('fields.stateCode'),
              statePlaceholder: t('fields.statePlaceholder'),
              stateHint: t('fields.stateHint'),
              gstin: t('fields.gstin'),
              gstinHint: t('fields.gstinHint'),
              addressLine: t('fields.addressLine'),
              city: t('fields.city'),
              pincode: t('fields.pincode'),
              phone: t('fields.phone'),
              phoneHint: t('fields.phoneHint'),
            }}
          />
          {!gstinTyped && (
            <Alert tone="warning" title={t('gstinMissing.title')}>
              {t('gstinMissing.body')}
            </Alert>
          )}
        </section>

        {canEdit && (
          <div>
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('saving') : t('save')}
            </Button>
          </div>
        )}

        <section aria-labelledby="logo-heading" className="flex flex-col gap-4">
          <h2
            id="logo-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('sections.logo')}
          </h2>
          <LogoField hasLogo={profile.hasLogo} canEdit={canEdit} />
        </section>
      </form>
    </FormProvider>
  );
}
