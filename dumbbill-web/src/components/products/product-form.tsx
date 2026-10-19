'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import {
  Alert,
  Button,
  Field,
  Input,
  MoneyText,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  useToast,
} from '@/components/ui';
import { ApiError, getBrowserApiClient, productsApi } from '@/lib/api';
import type { Product, ProductOptions } from '@/lib/api/schemas/products';
import { useCan } from '@/lib/auth/use-can';
import { paiseToRupeeText, parseRupeesToPaise } from '@/lib/format/money';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeFailure, type FailureView } from '../business/business-errors';
import { blankToNull } from '../business/place';
import { PriceDialog } from './price-dialog';
import { PriceHistory } from './price-history';
import { ProductImageField } from './product-image-field';

type ProductsT = ReturnType<typeof useTranslations<'Products'>>;

/** The sentinel the picker uses for "nothing chosen" (Radix Select cannot hold an empty value). */
const NONE = 'none';

function buildSchema(t: ProductsT, taxRequired: boolean, creating: boolean) {
  const optionalAmount = z
    .string()
    .refine(
      (value) => value.trim() === '' || parseRupeesToPaise(value) !== null,
      t('validation.amount'),
    );
  const requiredAmount = z
    .string()
    .refine((value) => parseRupeesToPaise(value) !== null, t('validation.amount'));
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(2, t('validation.nameRequired'))
        .max(150, t('validation.nameTooLong')),
      brand: z.string().trim().max(80, t('validation.brandTooLong')),
      variant: z.string().trim().max(80, t('validation.variantTooLong')),
      categoryId: z.string(),
      sku: z
        .string()
        .trim()
        .refine(
          (value) => value === '' || /^[A-Za-z0-9._\-/ ]{1,40}$/.test(value),
          t('validation.sku'),
        ),
      barcode: z
        .string()
        .trim()
        .refine(
          (value) => value === '' || /^[A-Za-z0-9._-]{3,32}$/.test(value),
          t('validation.barcode'),
        ),
      hsn: z
        .string()
        .trim()
        .refine(
          (value) => value === '' || /^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(value),
          t('validation.hsn'),
        ),
      gstRate: z.string(),
      mrp: creating ? requiredAmount : z.string(),
      price: creating ? requiredAmount : z.string(),
      cost: optionalAmount,
    })
    .superRefine((values, context) => {
      if (taxRequired && values.hsn === '')
        context.addIssue({ code: 'custom', path: ['hsn'], message: t('validation.hsnRequired') });
      if (taxRequired && (values.gstRate === '' || values.gstRate === NONE))
        context.addIssue({
          code: 'custom',
          path: ['gstRate'],
          message: t('validation.gstRequired'),
        });
      const mrp = parseRupeesToPaise(values.mrp);
      const price = parseRupeesToPaise(values.price);
      if (creating && mrp !== null && price !== null && price > mrp)
        context.addIssue({
          code: 'custom',
          path: ['price'],
          message: t('validation.priceAboveMrp'),
        });
    });
}

/**
 * Create a product, or edit one (journey J2, step 1).
 *
 * New product: all details plus the first MRP and selling price. Existing product: the details only; the price shows as
 * read-only with a "Change price" button, because every price change must be recorded with a reason (the price history
 * is shown below the form). The cost box appears only for people with `products.cost.read`; for everyone else it does
 * not exist, and the form never sends a cost.
 *
 * Choosing a category suggests its HSN and GST rate (only into empty boxes): they are suggestions, the CA decides.
 * When the business has a GSTIN, HSN and GST rate are required and the form says so.
 *
 * @param productId when given, the form edits that product; otherwise it creates one.
 */
export function ProductForm({ productId }: { productId?: string }) {
  const t = useTranslations('Products');
  const options = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => productsApi.getProductOptions(getBrowserApiClient()),
  });
  const product = useQuery({
    queryKey: ['products', 'one', productId],
    queryFn: () => productsApi.getProduct(getBrowserApiClient(), productId as string),
    enabled: Boolean(productId),
  });

  if (options.isPending || (productId && product.isPending)) {
    return (
      <div role="status" aria-label={t('loading')} className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full max-w-prose" />
        <Skeleton className="h-10 w-full max-w-prose" />
      </div>
    );
  }
  if (options.isError || product.isError) {
    const missing =
      product.error instanceof ApiError &&
      (product.error.status === 404 || product.error.status === 403);
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="danger" title={missing ? t('form.notFound') : t('loadFailed')} />
        <Link href="/products" className="text-small underline">
          {t('form.back')}
        </Link>
      </div>
    );
  }
  return <Fields existing={product.data} options={options.data} />;
}

function Fields({ existing, options }: { existing: Product | undefined; options: ProductOptions }) {
  const t = useTranslations('Products');
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan('products.write');
  const canPrice = useCan('pricing.write');
  const canSeeCost = useCan('products.cost.read');
  const creating = existing === undefined;
  const schema = useMemo(
    () => buildSchema(t, options.taxDetailsRequired, creating),
    [t, options.taxDetailsRequired, creating],
  );
  const form = useApiForm(schema, {
    defaultValues: {
      name: existing?.name ?? '',
      brand: existing?.brand ?? '',
      variant: existing?.variant ?? '',
      categoryId: existing?.categoryId ?? NONE,
      sku: existing?.sku ?? '',
      barcode: existing?.barcode ?? '',
      hsn: existing?.hsn ?? '',
      gstRate:
        existing?.gstRateBp === null || existing?.gstRateBp === undefined
          ? NONE
          : String(existing.gstRateBp),
      mrp: existing ? paiseToRupeeText(existing.mrpPaise) : '',
      price: existing ? paiseToRupeeText(existing.pricePaise) : '',
      cost:
        existing?.purchaseCostPaise === null || existing?.purchaseCostPaise === undefined
          ? ''
          : paiseToRupeeText(existing.purchaseCostPaise),
    },
  });
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [pricing, setPricing] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [categoryProblem, setCategoryProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (values: z.output<typeof schema>) => {
      const details = {
        name: values.name,
        brand: values.brand,
        variant: values.variant,
        categoryId: values.categoryId === NONE ? null : values.categoryId,
        sku: blankToNull(values.sku),
        barcode: blankToNull(values.barcode),
        hsn: blankToNull(values.hsn),
        gstRateBp: values.gstRate === NONE || values.gstRate === '' ? null : Number(values.gstRate),
        // Only people who may see cost send it; for everyone else the field is left out so the existing cost is kept.
        ...(canSeeCost
          ? {
              purchaseCostPaise: values.cost.trim() === '' ? null : parseRupeesToPaise(values.cost),
            }
          : {}),
      };
      const client = getBrowserApiClient();
      return existing
        ? productsApi.updateProduct(client, existing.id, details)
        : productsApi.createProduct(client, {
            ...details,
            mrpPaise: parseRupeesToPaise(values.mrp) as number,
            pricePaise: parseRupeesToPaise(values.price) as number,
          });
    },
  });

  const addCategory = useMutation({
    mutationFn: (name: string) => productsApi.createCategory(getBrowserApiClient(), { name }),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({ queryKey: ['products', 'options'] });
      form.setValue('categoryId', category.id);
      setNewCategory('');
      setCategoryProblem(null);
    },
    onError: (error) =>
      setCategoryProblem(
        error instanceof ApiError && error.code === 'CONFLICT'
          ? (error.fieldErrors[0]?.message ?? t('errors.clash'))
          : t('errors.generic'),
      ),
  });

  /** Suggest the category's HSN and GST rate, but only into boxes the person has not filled. */
  const onCategoryChosen = (categoryId: string) => {
    form.setValue('categoryId', categoryId);
    const category = options.categories.find((c) => c.id === categoryId);
    if (!category) return;
    if (form.getValues('hsn') === '' && category.defaultHsn)
      form.setValue('hsn', category.defaultHsn);
    if (form.getValues('gstRate') === NONE && category.defaultGstRateBp !== null)
      form.setValue('gstRate', String(category.defaultGstRateBp));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const saved = await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['business', 'onboarding'] });
      toast({ title: creating ? t('toast.created') : t('toast.saved'), tone: 'success' });
      // After creating, go to the edit page so a picture can be added straight away.
      router.push(creating ? `/products/${saved.id}` : '/products');
    } catch (error) {
      if (
        form.applyServerErrors(error, {
          gstRateBp: 'gstRate',
          mrpPaise: 'mrp',
          pricePaise: 'price',
          purchaseCostPaise: 'cost',
        })
      ) {
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
  const disabled = !canWrite;

  return (
    <div className="flex max-w-prose flex-col gap-10">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
            {failure.reference && (
              <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
            )}
          </Alert>
        )}

        <section aria-labelledby="basics-heading" className="flex flex-col gap-5">
          <h2
            id="basics-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('form.sections.basics')}
          </h2>
          <Field
            label={t('form.fields.name')}
            hint={t('form.fields.nameHint')}
            error={errors.name?.message}
            required
          >
            <Input {...form.register('name')} disabled={disabled} autoComplete="off" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('form.fields.brand')} error={errors.brand?.message}>
              <Input {...form.register('brand')} disabled={disabled} autoComplete="off" />
            </Field>
            <Field
              label={t('form.fields.variant')}
              hint={t('form.fields.variantHint')}
              error={errors.variant?.message}
            >
              <Input {...form.register('variant')} disabled={disabled} autoComplete="off" />
            </Field>
          </div>
          <Field
            label={t('form.fields.category')}
            hint={t('form.fields.categoryHint')}
            error={errors.categoryId?.message}
          >
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <Select
                  name={field.name}
                  value={field.value}
                  onValueChange={onCategoryChosen}
                  placeholder={t('form.fields.categoryPlaceholder')}
                  disabled={disabled}
                  options={[
                    { value: NONE, label: t('form.fields.categoryNone') },
                    ...options.categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              )}
            />
          </Field>
          {canWrite && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" type="button" className="self-start">
                  {t('form.newCategory')}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start">
                <div className="flex flex-col gap-3">
                  <Field label={t('form.newCategoryName')} error={categoryProblem ?? undefined}>
                    <Input
                      value={newCategory}
                      onChange={(event) => setNewCategory(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          if (newCategory.trim().length >= 2)
                            addCategory.mutate(newCategory.trim());
                        }
                      }}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={addCategory.isPending}
                    disabled={newCategory.trim().length < 2}
                    onClick={() => addCategory.mutate(newCategory.trim())}
                  >
                    {t('form.newCategorySave')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t('form.fields.barcode')}
              hint={t('form.fields.barcodeHint')}
              error={errors.barcode?.message}
            >
              <Input
                {...form.register('barcode')}
                disabled={disabled}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field
              label={t('form.fields.sku')}
              hint={t('form.fields.skuHint')}
              error={errors.sku?.message}
            >
              <Input
                {...form.register('sku')}
                disabled={disabled}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          </div>
        </section>

        <section aria-labelledby="tax-heading" className="flex flex-col gap-5">
          <h2
            id="tax-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('form.sections.tax')}
          </h2>
          {options.taxDetailsRequired && <Alert tone="info" title={t('form.taxRequired')} />}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t('form.fields.hsn')}
              hint={t('form.fields.hsnHint')}
              error={errors.hsn?.message}
              required={options.taxDetailsRequired}
            >
              <Input
                {...form.register('hsn')}
                disabled={disabled}
                inputMode="numeric"
                maxLength={8}
                className="font-mono"
              />
            </Field>
            <Field
              label={t('form.fields.gst')}
              error={errors.gstRate?.message}
              required={options.taxDetailsRequired}
            >
              <Controller
                control={form.control}
                name="gstRate"
                render={({ field }) => (
                  <Select
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={t('form.fields.gstPlaceholder')}
                    disabled={disabled}
                    options={[
                      { value: NONE, label: t('form.fields.gstNone') },
                      ...options.gstRatesBp.map((bp) => ({
                        value: String(bp),
                        label: t('gstValue', { percent: bp / 100 }),
                      })),
                    ]}
                  />
                )}
              />
            </Field>
          </div>
        </section>

        <section aria-labelledby="price-heading" className="flex flex-col gap-5">
          <h2
            id="price-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('form.sections.price')}
          </h2>
          {creating ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={t('form.fields.mrp')}
                hint={t('form.fields.mrpHint')}
                error={errors.mrp?.message}
                required
              >
                <Input {...form.register('mrp')} inputMode="decimal" className="font-mono" />
              </Field>
              <Field
                label={t('form.fields.price')}
                hint={t('form.fields.priceHint')}
                error={errors.price?.message}
                required
              >
                <Input {...form.register('price')} inputMode="decimal" className="font-mono" />
              </Field>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <p className="text-small">
                <span className="text-muted">{t('form.mrpNow')}: </span>
                <MoneyText paise={existing.mrpPaise} tone="muted" />
              </p>
              <p className="text-small">
                <span className="text-muted">{t('form.currentPrice')}: </span>
                <MoneyText paise={existing.pricePaise} />
              </p>
              {canPrice && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPricing(true)}
                >
                  {t('form.changePrice')}
                </Button>
              )}
            </div>
          )}
        </section>

        {canSeeCost && (
          <section aria-labelledby="cost-heading" className="flex flex-col gap-5">
            <h2
              id="cost-heading"
              className="text-small font-semibold tracking-wide text-muted uppercase"
            >
              {t('form.sections.cost')}
            </h2>
            <Field
              label={t('form.fields.cost')}
              hint={t('form.fields.costHint')}
              error={errors.cost?.message}
            >
              <Input
                {...form.register('cost')}
                disabled={disabled}
                inputMode="decimal"
                className="font-mono"
              />
            </Field>
          </section>
        )}

        <div className="flex gap-3">
          {canWrite && (
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? t('form.saving')
                : creating
                  ? t('form.create')
                  : t('form.save')}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/products">{t('form.back')}</Link>
          </Button>
        </div>
      </form>

      <section aria-labelledby="picture-heading" className="flex flex-col gap-4">
        <h2
          id="picture-heading"
          className="text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('form.sections.picture')}
        </h2>
        {existing ? (
          <ProductImageField
            productId={existing.id}
            hasImage={existing.hasImage}
            canEdit={canWrite}
          />
        ) : (
          <p className="text-small text-muted">{t('image.saveFirst')}</p>
        )}
      </section>

      {existing && canWrite && (
        <section aria-labelledby="history-heading" className="flex flex-col gap-4">
          <h2
            id="history-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('form.sections.history')}
          </h2>
          <PriceHistory
            productId={existing.id}
            refreshKey={`${existing.mrpPaise}-${existing.pricePaise}`}
          />
        </section>
      )}

      {existing && pricing && (
        <PriceDialog
          product={existing}
          open
          onOpenChange={(open) => !open && setPricing(false)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['products'] })}
        />
      )}
    </div>
  );
}
