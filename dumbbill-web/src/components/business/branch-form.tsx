'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Controller, FormProvider } from 'react-hook-form';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Field, Input, Select, Skeleton, useToast } from '@/components/ui';
import { ApiError, businessApi, getBrowserApiClient } from '@/lib/api';
import type { Branch } from '@/lib/api/schemas/business';
import { useCan } from '@/lib/auth/use-can';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeFailure, type FailureView } from './business-errors';
import { blankToNull, PlaceFields, placeDefaults, placeShape } from './place';

type BranchT = ReturnType<typeof useTranslations<'Branches'>>;

function buildSchema(t: BranchT) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(2, t('validation.nameRequired'))
      .max(80, t('validation.nameTooLong')),
    invoicePrefix: z
      .string()
      .transform((value) => value.replace(/\s+/g, '').toUpperCase())
      .pipe(
        z
          .string()
          .min(1, t('validation.prefixRequired'))
          .regex(/^[A-Z0-9]{1,6}$/, t('validation.prefixShape')),
      ),
    printerWidthMm: z.enum(['58', '80']),
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

/**
 * Create a branch, or edit one. Both use the same form: a branch is its name, the prefix printed on its invoices,
 * its receipt paper width, and its place (state, optional GSTIN, address) which decides tax for sales made there.
 *
 * Creating counts against the plan's branch limit; at the limit the server answers PLAN_LIMIT_REACHED and this form
 * explains it in words. A prefix or name another branch already has is shown under that box.
 *
 * @param branchId when given, the form edits that branch; otherwise it creates one.
 */
export function BranchForm({ branchId }: { branchId?: string }) {
  const t = useTranslations('Branches');
  const states = useQuery({
    queryKey: ['business', 'gst-states'],
    queryFn: () => businessApi.listGstStates(getBrowserApiClient()),
    staleTime: Infinity,
  });
  const branch = useQuery({
    queryKey: ['branches', branchId],
    queryFn: () => businessApi.getBranch(getBrowserApiClient(), branchId as string),
    enabled: Boolean(branchId),
  });

  if (states.isPending || (branchId && branch.isPending)) {
    return (
      <div role="status" aria-label={t('loading')} className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full max-w-prose" />
        <Skeleton className="h-10 w-full max-w-prose" />
      </div>
    );
  }
  if (states.isError || branch.isError) {
    const missing =
      branch.error instanceof ApiError &&
      (branch.error.status === 404 || branch.error.status === 403);
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="danger" title={missing ? t('editPage.notFound') : t('loadFailed')} />
        <Link href="/branches" className="text-small underline">
          {t('editPage.back')}
        </Link>
      </div>
    );
  }
  return <Fields existing={branch.data} states={states.data} />;
}

function Fields({
  existing,
  states,
}: {
  existing: Branch | undefined;
  states: Awaited<ReturnType<typeof businessApi.listGstStates>>;
}) {
  const t = useTranslations('Branches');
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = useCan('settings.manage');
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: {
      name: existing?.name ?? '',
      invoicePrefix: existing?.invoicePrefix ?? '',
      printerWidthMm: String(existing?.printerWidthMm ?? 80) as '58' | '80',
      ...placeDefaults(
        existing ?? {
          stateCode: null,
          gstin: null,
          addressLine: null,
          city: null,
          pincode: null,
          phone: null,
        },
      ),
    },
  });
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [planFull, setPlanFull] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (values: z.output<typeof schema>) => {
      const body = {
        name: values.name,
        invoicePrefix: values.invoicePrefix,
        printerWidthMm: Number(values.printerWidthMm) as 58 | 80,
        stateCode: values.stateCode,
        gstin: blankToNull(values.gstin),
        addressLine: blankToNull(values.addressLine),
        city: blankToNull(values.city),
        pincode: blankToNull(values.pincode),
        phone: blankToNull(values.phone),
      };
      const client = getBrowserApiClient();
      return existing
        ? businessApi.updateBranch(client, existing.id, body)
        : businessApi.createBranch(client, body);
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    setPlanFull(null);
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      await queryClient.invalidateQueries({ queryKey: ['business', 'onboarding'] });
      toast({ title: existing ? t('toast.saved') : t('toast.created'), tone: 'success' });
      router.push('/branches');
    } catch (error) {
      if (form.applyServerErrors(error)) return;
      if (error instanceof ApiError && error.code === 'PLAN_LIMIT_REACHED') {
        setPlanFull(error.detail ?? '');
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

  const errors = form.formState.errors;

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} noValidate className="flex max-w-prose flex-col gap-6">
        {!canEdit && <Alert tone="info" title={t('errors.forbidden')} />}
        {planFull !== null && (
          <Alert tone="warning" title={t('limit.title')}>
            {planFull}
          </Alert>
        )}
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
            {failure.reference && (
              <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
            )}
          </Alert>
        )}

        <Field
          label={t('fields.name')}
          hint={t('fields.nameHint')}
          error={errors.name?.message}
          required
        >
          <Input {...form.register('name')} disabled={!canEdit} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('fields.invoicePrefix')}
            hint={t('fields.invoicePrefixHint')}
            error={errors.invoicePrefix?.message}
            required
          >
            <Input
              {...form.register('invoicePrefix')}
              disabled={!canEdit}
              autoComplete="off"
              maxLength={8}
              className="font-mono uppercase"
            />
          </Field>
          <Field
            label={t('fields.printerWidthMm')}
            hint={t('fields.printerWidthHint')}
            error={errors.printerWidthMm?.message}
            required
          >
            <Controller
              control={form.control}
              name="printerWidthMm"
              render={({ field }) => (
                <Select
                  name={field.name}
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={!canEdit}
                  options={[
                    { value: '58', label: t('paper.58') },
                    { value: '80', label: t('paper.80') },
                  ]}
                />
              )}
            />
          </Field>
        </div>

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
          }}
        />

        <div className="flex gap-3">
          {canEdit && (
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? t('submitting')
                : existing
                  ? t('submitSave')
                  : t('submitCreate')}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/branches">{t('editPage.back')}</Link>
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
