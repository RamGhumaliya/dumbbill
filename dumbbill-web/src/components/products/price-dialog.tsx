'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Dialog, Field, Input, useToast } from '@/components/ui';
import { ApiError, getBrowserApiClient, productsApi } from '@/lib/api';
import type { Product } from '@/lib/api/schemas/products';
import { formatPaise, paiseToRupeeText, parseRupeesToPaise } from '@/lib/format/money';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeFailure, type FailureView } from '../business/business-errors';

type ProductsT = ReturnType<typeof useTranslations<'Products'>>;

function buildSchema(t: ProductsT) {
  return z
    .object({
      mrp: z.string().refine((value) => parseRupeesToPaise(value) !== null, t('validation.amount')),
      price: z
        .string()
        .refine((value) => parseRupeesToPaise(value) !== null, t('validation.amount')),
      reason: z.string().trim().min(3, t('validation.reasonRequired')).max(200),
      startsAt: z.string(),
    })
    .superRefine((values, context) => {
      const mrp = parseRupeesToPaise(values.mrp);
      const price = parseRupeesToPaise(values.price);
      if (mrp !== null && price !== null && price > mrp) {
        context.addIssue({
          code: 'custom',
          path: ['price'],
          message: t('validation.priceAboveMrp'),
        });
      }
    });
}

/**
 * The "Change price" dialog (US-PRICE-01). A price is never edited: this adds a row to the price history with the
 * person's name, the reason and the start time, so every change can be explained later.
 *
 * The start time is optional: empty means "now", a later time schedules the change (the price in force stays the same
 * until then). The server refuses a start in the past, a selling price above the MRP, and a "change" to the price the
 * product already has; each comes back as a message under the right box.
 *
 * @param suggestedPricePaise pre-fills the new price (used when the person typed it into the table cell).
 */
export function PriceDialog({
  product,
  suggestedPricePaise,
  open,
  onOpenChange,
  onChanged,
}: {
  product: Product;
  suggestedPricePaise?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: (product: Product) => void;
}) {
  const t = useTranslations('Products');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: {
      mrp: paiseToRupeeText(product.mrpPaise),
      price: paiseToRupeeText(suggestedPricePaise ?? product.pricePaise),
      reason: '',
      startsAt: '',
    },
  });
  const [failure, setFailure] = useState<FailureView | null>(null);

  const change = useMutation({
    mutationFn: (values: z.output<typeof schema>) =>
      productsApi.changePrice(getBrowserApiClient(), product.id, {
        mrpPaise: parseRupeesToPaise(values.mrp) as number,
        pricePaise: parseRupeesToPaise(values.price) as number,
        reason: values.reason,
        ...(values.startsAt ? { effectiveFrom: new Date(values.startsAt).toISOString() } : {}),
      }),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const saved = await change.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({
        title: values.startsAt ? t('toast.priceScheduled') : t('toast.priceChanged'),
        tone: 'success',
      });
      onChanged?.(saved);
      onOpenChange(false);
    } catch (error) {
      if (
        form.applyServerErrors(error, {
          mrpPaise: 'mrp',
          pricePaise: 'price',
          effectiveFrom: 'startsAt',
        })
      ) {
        return;
      }
      if (error instanceof ApiError && error.code === 'BUSINESS_RULE_VIOLATION') {
        setFailure({ title: t('errors.title'), body: t('priceDialog.sameAsNow') });
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

  const typedPrice = parseRupeesToPaise(form.watch('price'));
  const cost = product.purchaseCostPaise;
  const belowCost = cost !== undefined && cost !== null && typedPrice !== null && typedPrice < cost;
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('priceDialog.title', { name: product.name })}
      description={t('priceDialog.description')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('priceDialog.cancel')}
          </Button>
          <Button variant="primary" loading={form.formState.isSubmitting} onClick={onSubmit}>
            {t('priceDialog.submit')}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
            {failure.reference && (
              <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
            )}
          </Alert>
        )}
        <p className="text-small text-muted">
          {t('form.currentPrice')}: {formatPaise(product.pricePaise)}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('priceDialog.mrp')} error={errors.mrp?.message} required>
            <Input {...form.register('mrp')} inputMode="decimal" className="font-mono" />
          </Field>
          <Field label={t('priceDialog.price')} error={errors.price?.message} required>
            <Input {...form.register('price')} inputMode="decimal" className="font-mono" />
          </Field>
        </div>
        {belowCost && <Alert tone="warning" title={t('priceDialog.belowCost')} />}
        <Field
          label={t('priceDialog.reason')}
          hint={t('priceDialog.reasonHint')}
          error={errors.reason?.message}
          required
        >
          <Input {...form.register('reason')} autoComplete="off" />
        </Field>
        <Field
          label={t('priceDialog.startsAt')}
          hint={t('priceDialog.startsHint')}
          error={errors.startsAt?.message}
        >
          <Input {...form.register('startsAt')} type="datetime-local" />
        </Field>
        {/* Pressing Enter in a box submits, like the button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('priceDialog.submit')}
        </button>
      </form>
    </Dialog>
  );
}
