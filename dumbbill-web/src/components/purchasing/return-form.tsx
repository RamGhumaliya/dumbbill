'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import {
  Alert,
  Button,
  Field,
  IconButton,
  Input,
  MoneyText,
  Select,
  useToast,
} from '@/components/ui';
import { CloseIcon } from '@/components/ui/icons';
import { ApiError, businessApi, getBrowserApiClient, inventoryApi } from '@/lib/api';
import { parseRupeesToPaise } from '@/lib/format/money';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeFailure, type FailureView } from '../business/business-errors';
import { ProductPicker } from '../products/product-picker';

type PurchasesT = ReturnType<typeof useTranslations<'Purchases'>>;

const EMPTY_LINE = { productId: '', qty: '', credit: '' };

function buildSchema(t: PurchasesT) {
  return z.object({
    supplierId: z.string().min(1, t('validation.supplierRequired')),
    branchId: z.string().min(1, t('validation.branchRequired')),
    reason: z.string().trim().min(3, t('returnForm.validation.reasonRequired')).max(200),
    note: z.string().trim().max(500),
    lines: z
      .array(
        z.object({
          productId: z.string().min(1, t('validation.productRequired')),
          qty: z.string().regex(/^[1-9][0-9]{0,6}$/, t('validation.qty')),
          credit: z
            .string()
            .refine((value) => parseRupeesToPaise(value) !== null, t('validation.amount')),
        }),
      )
      .min(1, t('validation.needOneLine')),
  });
}

/**
 * Send goods back to a supplier and create a numbered debit note (US-PUR-01 returns).
 *
 * Stock leaves at its average cost (the server does that); the CREDIT typed here is what the supplier agrees to give per
 * unit, and it lowers what the shop owes them. If a line asks for more than is on hand the server refuses the whole note
 * (INSUFFICIENT_STOCK) and nothing is saved. One Idempotency-Key per form makes a retry safe.
 */
export function ReturnForm() {
  const t = useTranslations('Purchases');
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: { supplierId: '', branchId: '', reason: '', note: '', lines: [EMPTY_LINE] },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const [failure, setFailure] = useState<FailureView | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const suppliers = useQuery({
    queryKey: ['suppliers', 'list', { q: '', status: 'active' }],
    queryFn: () => inventoryApi.listSuppliers(getBrowserApiClient(), { status: 'active' }),
  });
  const branches = useQuery({
    queryKey: ['branches', 'list'],
    queryFn: () => businessApi.listBranches(getBrowserApiClient()),
  });

  const values = form.watch();
  const creditTotal = values.lines.reduce((sum, line) => {
    const qty = /^[1-9][0-9]{0,6}$/.test(line.qty) ? Number(line.qty) : 0;
    return sum + qty * (parseRupeesToPaise(line.credit) ?? 0);
  }, 0);

  const create = useMutation({
    mutationFn: (submitted: z.output<typeof schema>) =>
      inventoryApi.createSupplierReturn(
        getBrowserApiClient(),
        {
          supplierId: submitted.supplierId,
          branchId: submitted.branchId,
          reason: submitted.reason,
          note: submitted.note === '' ? null : submitted.note,
          lines: submitted.lines.map((line) => ({
            productId: line.productId,
            qty: Number(line.qty),
            unitCreditPaise: parseRupeesToPaise(line.credit) as number,
          })),
        },
        idempotencyKey.current,
      ),
  });

  const onSubmit = form.handleSubmit(async (submitted) => {
    setFailure(null);
    try {
      const saved = await create.mutateAsync(submitted);
      await queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast({ title: t('returnForm.saved', { number: saved.debitNoteNo }), tone: 'success' });
      router.push('/purchases/returns');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
        setFailure({
          title: t('errors.title'),
          body: t('returnForm.insufficient', { detail: error.detail ?? '' }),
        });
        return;
      }
      if (error instanceof ApiError && error.code === 'IDEMPOTENCY_KEY_REUSED') {
        setFailure({ title: t('errors.title'), body: t('errors.keyReused') });
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
  const rowError = (index: number, name: 'productId' | 'qty' | 'credit') =>
    (errors.lines?.[index] as Record<string, { message?: string } | undefined> | undefined)?.[name]
      ?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-4xl flex-col gap-8">
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
          {failure.reference && (
            <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
          )}
        </Alert>
      )}
      <section className="grid gap-5 sm:grid-cols-2">
        <Field label={t('returnForm.supplier')} error={errors.supplierId?.message} required>
          <Controller
            control={form.control}
            name="supplierId"
            render={({ field }) => (
              <Select
                name={field.name}
                value={field.value === '' ? undefined : field.value}
                onValueChange={field.onChange}
                placeholder={t('header.supplierPlaceholder')}
                options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              />
            )}
          />
        </Field>
        <Field label={t('returnForm.branch')} error={errors.branchId?.message} required>
          <Controller
            control={form.control}
            name="branchId"
            render={({ field }) => (
              <Select
                name={field.name}
                value={field.value === '' ? undefined : field.value}
                onValueChange={field.onChange}
                placeholder={t('header.branchPlaceholder')}
                options={(branches.data?.branches ?? [])
                  .filter((b) => b.isActive)
                  .map((b) => ({ value: b.id, label: b.name }))}
              />
            )}
          />
        </Field>
        <Field
          label={t('returnForm.reason')}
          hint={t('returnForm.reasonHint')}
          error={errors.reason?.message}
          required
        >
          <Input {...form.register('reason')} autoComplete="off" />
        </Field>
        <Field label={t('header.note')} error={errors.note?.message}>
          <Input {...form.register('note')} autoComplete="off" />
        </Field>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="return-lines-heading">
        <h2
          id="return-lines-heading"
          className="text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('returnForm.lines')}
        </h2>
        <p className="text-caption text-muted">{t('grid.productHint')}</p>
        <ul className="flex flex-col gap-4">
          {lines.fields.map((item, index) => {
            const number = index + 1;
            const label = (name: string) => `${name}, ${t('grid.rowLabel', { number })}`;
            return (
              <li
                key={item.id}
                className="grid items-start gap-3 sm:grid-cols-[1fr_7rem_9rem_auto]"
              >
                <div>
                  <ProductPicker
                    ariaLabel={label(t('returnForm.product'))}
                    placeholder={t('grid.productPlaceholder')}
                    invalid={Boolean(rowError(index, 'productId'))}
                    onPick={(chosen) =>
                      form.setValue(`lines.${index}.productId`, chosen?.id ?? '', {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                  />
                  {rowError(index, 'productId') && (
                    <p role="alert" className="mt-1 text-caption font-medium text-danger">
                      {rowError(index, 'productId')}
                    </p>
                  )}
                </div>
                <div>
                  <Input
                    {...form.register(`lines.${index}.qty`)}
                    aria-label={label(t('returnForm.qty'))}
                    aria-invalid={rowError(index, 'qty') ? true : undefined}
                    inputMode="numeric"
                    autoComplete="off"
                    className="text-right font-mono"
                  />
                  {rowError(index, 'qty') && (
                    <p role="alert" className="mt-1 text-caption font-medium text-danger">
                      {rowError(index, 'qty')}
                    </p>
                  )}
                </div>
                <div>
                  <Input
                    {...form.register(`lines.${index}.credit`)}
                    aria-label={label(t('returnForm.credit'))}
                    aria-invalid={rowError(index, 'credit') ? true : undefined}
                    inputMode="decimal"
                    autoComplete="off"
                    className="text-right font-mono"
                  />
                  {rowError(index, 'credit') && (
                    <p role="alert" className="mt-1 text-caption font-medium text-danger">
                      {rowError(index, 'credit')}
                    </p>
                  )}
                </div>
                <IconButton
                  label={t('returnForm.removeRow', { number })}
                  size="sm"
                  type="button"
                  disabled={lines.fields.length === 1}
                  onClick={() => lines.remove(index)}
                >
                  <CloseIcon />
                </IconButton>
              </li>
            );
          })}
        </ul>
        {errors.lines?.message && (
          <p role="alert" className="text-caption font-medium text-danger">
            {errors.lines.message}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => lines.append(EMPTY_LINE)}
          >
            {t('returnForm.addRow')}
          </Button>
          <p className="text-small">
            <span className="text-muted">{t('returnForm.creditTotal')}: </span>
            <MoneyText paise={creditTotal} size="total" />
          </p>
        </div>
      </section>

      <div className="flex gap-3">
        <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('returnForm.submitting') : t('returnForm.submit')}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/purchases/returns">{t('returnsPage.back')}</Link>
        </Button>
      </div>
    </form>
  );
}
