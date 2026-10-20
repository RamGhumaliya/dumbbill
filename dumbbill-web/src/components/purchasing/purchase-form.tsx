'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { Controller, FormProvider, useFieldArray, type FieldPath } from 'react-hook-form';
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
import type { Product } from '@/lib/api/schemas/products';
import { todayInIndia } from '@/lib/format/datetime';
import { parseRupeesToPaise } from '@/lib/format/money';
import { useApiForm } from '@/lib/forms/use-api-form';
import { allocateExtraCost, landedLineValue, previewAverageCost } from '@/lib/inventory/costing';
import { describeFailure, type FailureView } from '../business/business-errors';
import { ProductPicker } from '../products/product-picker';

type PurchasesT = ReturnType<typeof useTranslations<'Purchases'>>;

const EMPTY_LINE = { productId: '', qty: '', unitCost: '', batchNo: '', expiry: '' };

/** The cells of a row, in the order Enter moves through them. */
const CELLS = ['product', 'qty', 'unitCost', 'batchNo', 'expiry'] as const;

function buildSchema(t: PurchasesT) {
  const today = todayInIndia();
  const line = z.object({
    productId: z.string().min(1, t('validation.productRequired')),
    qty: z.string().regex(/^[1-9][0-9]{0,6}$/, t('validation.qty')),
    unitCost: z
      .string()
      .refine((value) => parseRupeesToPaise(value) !== null, t('validation.amount')),
    batchNo: z.string().trim().max(40),
    expiry: z
      .string()
      .refine(
        (value) => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today),
        t('validation.expiry'),
      ),
  });
  return z.object({
    supplierId: z.string().min(1, t('validation.supplierRequired')),
    branchId: z.string().min(1, t('validation.branchRequired')),
    invoiceRef: z.string().trim().min(1, t('validation.invoiceRequired')).max(60),
    invoiceDate: z.string().min(1, t('validation.dateRequired')),
    otherCost: z
      .string()
      .refine(
        (value) => value.trim() === '' || parseRupeesToPaise(value) !== null,
        t('validation.amount'),
      ),
    note: z.string().trim().max(500),
    lines: z.array(line).min(1, t('validation.needOneLine')),
  });
}

/** Server field names on a line, as the form names them. */
const LINE_FIELD: Record<string, (typeof CELLS)[number]> = {
  productId: 'product',
  qty: 'qty',
  unitCostPaise: 'unitCost',
  batchNo: 'batchNo',
  expiryDate: 'expiry',
};

/**
 * Record a supplier's bill (journey J2, US-PUR-01), spreadsheet style.
 *
 * The person types the bill as it is on paper. Each line shows, as they type, what the goods REALLY cost once their share
 * of the freight is added (the landed cost), and, for people who may see costs, what the weighted average cost of that
 * product at that branch will become. Enter moves to the next cell and, after the last cell of the last line, starts a new
 * line, so the whole bill can be typed without touching the mouse. A barcode scanner works in the product cell.
 *
 * The preview repeats the server's rules so it can answer before saving; after saving the server's own numbers are shown on
 * the purchase page. One Idempotency-Key is made for the form and reused if the person retries, so a double tap or a lost
 * connection never enters the bill twice.
 */
export function PurchaseForm() {
  const t = useTranslations('Purchases');
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: {
      supplierId: '',
      branchId: '',
      invoiceRef: '',
      invoiceDate: todayInIndia(),
      otherCost: '',
      note: '',
      lines: [EMPTY_LINE],
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const [picked, setPicked] = useState<Record<number, Product | null>>({});
  const [failure, setFailure] = useState<FailureView | null>(null);
  // ONE key for this form: a retry of the same bill reuses it, so the bill is never entered twice.
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
  const branchId = values.branchId;

  // What each picked product is worth at the chosen branch now (only people with cost access get the numbers back).
  const pickedProducts = Object.values(picked).filter((p): p is Product => Boolean(p));
  const heldQueries = useQueries({
    queries: [...new Map(pickedProducts.map((p) => [p.id, p])).values()].map((product) => ({
      queryKey: ['stock', 'held', branchId, product.id],
      enabled: Boolean(branchId),
      queryFn: async () => {
        const result = await inventoryApi.listStock(getBrowserApiClient(), {
          branchId,
          q: product.barcode ?? product.name,
          limit: 10,
        });
        return {
          productId: product.id,
          row: result.items.find((row) => row.productId === product.id),
        };
      },
    })),
  });
  const held = new Map(
    heldQueries.flatMap((query) =>
      query.data ? [[query.data.productId, query.data.row] as const] : [],
    ),
  );

  // --- the live numbers ---
  const parsed = values.lines.map((line) => {
    const qty = /^[1-9][0-9]{0,6}$/.test(line.qty) ? Number(line.qty) : null;
    const unit = parseRupeesToPaise(line.unitCost);
    return qty !== null && unit !== null ? { qty, unitCostPaise: unit } : null;
  });
  const extraPaise = parseRupeesToPaise(values.otherCost || '0') ?? 0;
  const valid = parsed.flatMap((line, index) => (line ? [{ index, line }] : []));
  const shares = allocateExtraCost(
    valid.map(({ line }) => line),
    extraPaise,
  );
  const landedByRow = new Map(
    valid.map(({ index, line }, i) => [index, landedLineValue(line, shares[i] as number)]),
  );
  const subtotal = valid.reduce((sum, { line }) => sum + line.qty * line.unitCostPaise, 0);

  const create = useMutation({
    mutationFn: (submitted: z.output<typeof schema>) =>
      inventoryApi.createPurchase(
        getBrowserApiClient(),
        {
          supplierId: submitted.supplierId,
          branchId: submitted.branchId,
          invoiceRef: submitted.invoiceRef,
          invoiceDate: submitted.invoiceDate,
          otherCostPaise: parseRupeesToPaise(submitted.otherCost || '0') ?? 0,
          note: submitted.note === '' ? null : submitted.note,
          lines: submitted.lines.map((line) => ({
            productId: line.productId,
            qty: Number(line.qty),
            unitCostPaise: parseRupeesToPaise(line.unitCost) as number,
            batchNo: line.batchNo === '' ? null : line.batchNo,
            expiryDate: line.expiry === '' ? null : line.expiry,
          })),
        },
        idempotencyKey.current,
      ),
  });

  /** Put each server message next to its cell, even for rows (`lines[2].expiryDate`). */
  const showServerErrors = (error: unknown): boolean => {
    if (!(error instanceof ApiError) || error.fieldErrors.length === 0) return false;
    if (error.code !== 'VALIDATION_FAILED' && error.code !== 'CONFLICT') return false;
    for (const { field, message } of error.fieldErrors) {
      const row = /^lines\[(\d+)\]\.(\w+)$/.exec(field);
      const name = row
        ? (`lines.${row[1]}.${LINE_FIELD[row[2] as string] ?? row[2]}` as FieldPath<
            z.input<typeof schema>
          >)
        : (field as FieldPath<z.input<typeof schema>>);
      form.setError(name, { type: 'server', message });
    }
    return true;
  };

  const onSubmit = form.handleSubmit(async (submitted) => {
    setFailure(null);
    try {
      const saved = await create.mutateAsync(submitted);
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      await queryClient.invalidateQueries({ queryKey: ['business', 'onboarding'] });
      toast({ title: t('saved'), tone: 'success' });
      router.push(`/purchases/${saved.id}`);
    } catch (error) {
      if (showServerErrors(error)) return;
      if (error instanceof ApiError && error.code === 'IDEMPOTENCY_KEY_REUSED') {
        setFailure({ title: t('errors.title'), body: t('errors.keyReused') });
        return;
      }
      if (error instanceof ApiError && error.code === 'BUSINESS_RULE_VIOLATION' && error.detail) {
        setFailure({ title: t('errors.title'), body: error.detail });
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

  /** Enter moves right along the row; after the last cell of the last row it starts a new line. */
  const moveFocus = (row: number, cell: number) => {
    const last = cell === CELLS.length - 1;
    if (last && row === lines.fields.length - 1) {
      lines.append(EMPTY_LINE);
      window.requestAnimationFrame(() => focusCell(row + 1, 0));
    } else {
      focusCell(last ? row + 1 : row, last ? 0 : cell + 1);
    }
  };

  const errors = form.formState.errors;
  const lineError = (index: number, cell: (typeof CELLS)[number]) =>
    (errors.lines?.[index] as Record<string, { message?: string } | undefined> | undefined)?.[
      cell === 'product' ? 'productId' : cell
    ]?.message;

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
            {failure.reference && (
              <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
            )}
          </Alert>
        )}

        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('new.title')}>
          <Field label={t('header.supplier')} error={errors.supplierId?.message} required>
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
          <Field label={t('header.branch')} error={errors.branchId?.message} required>
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
          <Field label={t('header.invoiceRef')} error={errors.invoiceRef?.message} required>
            <Input {...form.register('invoiceRef')} autoComplete="off" className="font-mono" />
          </Field>
          <Field label={t('header.invoiceDate')} error={errors.invoiceDate?.message} required>
            <Input {...form.register('invoiceDate')} type="date" max={todayInIndia()} />
          </Field>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="lines-heading">
          <h2
            id="lines-heading"
            className="text-small font-semibold tracking-wide text-muted uppercase"
          >
            {t('grid.caption')}
          </h2>
          <p className="text-caption text-muted">{t('grid.productHint')}</p>
          <div className="overflow-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-240 border-collapse text-small">
              <caption className="sr-only">{t('grid.caption')}</caption>
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b-2 border-rule">
                  {[
                    ['product', t('grid.product'), 'text-left'],
                    ['qty', t('grid.qty'), 'text-right'],
                    ['unitCost', t('grid.unitCost'), 'text-right'],
                    ['batchNo', t('grid.batchNo'), 'text-left'],
                    ['expiry', t('grid.expiry'), 'text-left'],
                    ['landed', t('grid.landed'), 'text-right'],
                    ['average', t('grid.newAverage'), 'text-right'],
                    ['remove', '', 'text-right'],
                  ].map(([id, label, align]) => (
                    <th
                      key={id}
                      scope="col"
                      className={`px-2 py-2 text-micro font-medium tracking-wider whitespace-nowrap text-muted uppercase ${align}`}
                    >
                      {label}
                      {id === 'remove' && (
                        <span className="sr-only">{t('grid.removeRow', { number: '' })}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.fields.map((item, index) => {
                  const number = index + 1;
                  const product = picked[index];
                  const heldRow = product ? held.get(product.id) : undefined;
                  const landed = landedByRow.get(index);
                  const lineValue = parsed[index];
                  const showAverage =
                    heldRow?.wacPaise !== undefined &&
                    heldRow.valuePaise !== undefined &&
                    landed !== undefined &&
                    lineValue;
                  const cellLabel = (name: string) => `${name}, ${t('grid.rowLabel', { number })}`;
                  const onEnter = (cell: number) => (event: React.KeyboardEvent) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      moveFocus(index, cell);
                    }
                  };
                  return (
                    <tr
                      key={item.id}
                      aria-label={t('grid.rowLabel', { number })}
                      className="border-b border-line align-top last:border-b-0"
                    >
                      <td className="min-w-72 px-2 py-2">
                        <div data-cell={`product-${index}`}>
                          <ProductPicker
                            ariaLabel={cellLabel(t('grid.product'))}
                            placeholder={t('grid.productPlaceholder')}
                            invalid={Boolean(lineError(index, 'product'))}
                            onPick={(chosen) => {
                              setPicked((previous) => ({ ...previous, [index]: chosen }));
                              form.setValue(`lines.${index}.productId`, chosen?.id ?? '', {
                                shouldValidate: form.formState.isSubmitted,
                              });
                              if (chosen) focusCell(index, 1);
                            }}
                          />
                        </div>
                        {lineError(index, 'product') && (
                          <p role="alert" className="mt-1 text-caption font-medium text-danger">
                            {lineError(index, 'product')}
                          </p>
                        )}
                      </td>
                      {(['qty', 'unitCost', 'batchNo', 'expiry'] as const).map((cell, offset) => (
                        <td
                          key={cell}
                          className={`px-2 py-2 ${cell === 'qty' || cell === 'unitCost' ? 'w-28' : cell === 'expiry' ? 'w-44' : 'w-36'}`}
                        >
                          <Input
                            {...form.register(`lines.${index}.${cell}`)}
                            data-cell={`${cell}-${index}`}
                            aria-label={cellLabel(
                              {
                                qty: t('grid.qty'),
                                unitCost: t('grid.unitCost'),
                                batchNo: t('grid.batchNo'),
                                expiry: t('grid.expiry'),
                              }[cell],
                            )}
                            aria-invalid={lineError(index, cell) ? true : undefined}
                            inputMode={
                              cell === 'qty'
                                ? 'numeric'
                                : cell === 'unitCost'
                                  ? 'decimal'
                                  : undefined
                            }
                            type={cell === 'expiry' ? 'date' : 'text'}
                            autoComplete="off"
                            className={
                              cell === 'qty' || cell === 'unitCost'
                                ? 'text-right font-mono'
                                : 'font-mono'
                            }
                            onKeyDown={onEnter(offset + 1)}
                          />
                          {lineError(index, cell) && (
                            <p role="alert" className="mt-1 text-caption font-medium text-danger">
                              {lineError(index, cell)}
                            </p>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-3 text-right">
                        {landed !== undefined ? (
                          <MoneyText paise={landed} />
                        ) : (
                          <span className="text-muted">·</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {showAverage && lineValue ? (
                          <span className="flex flex-col items-end">
                            <MoneyText
                              paise={previewAverageCost(
                                { qty: heldRow.qty, valuePaise: heldRow.valuePaise as number },
                                { qty: lineValue.qty, valuePaise: landed as number },
                              )}
                            />
                            <span className="text-caption text-muted">
                              {t('grid.stockNow', {
                                qty: heldRow.qty,
                                average: formatRupees(heldRow.wacPaise as number),
                              })}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">·</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <IconButton
                          label={t('grid.removeRow', { number })}
                          size="sm"
                          type="button"
                          disabled={lines.fields.length === 1}
                          onClick={() => {
                            lines.remove(index);
                            setPicked((previous) => reindexAfterRemoval(previous, index));
                          }}
                        >
                          <CloseIcon />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.lines?.message && (
            <p role="alert" className="text-caption font-medium text-danger">
              {errors.lines.message}
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                lines.append(EMPTY_LINE);
                window.requestAnimationFrame(() => focusCell(lines.fields.length, 0));
              }}
            >
              {t('grid.addRow')}
            </Button>
          </div>
        </section>

        <section className="flex flex-wrap items-start justify-between gap-8">
          <div className="flex w-full max-w-md flex-col gap-5">
            <Field
              label={t('footer.extra')}
              hint={t('footer.extraHint')}
              error={errors.otherCost?.message}
            >
              <Input
                {...form.register('otherCost')}
                inputMode="decimal"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field label={t('header.note')} error={errors.note?.message}>
              <Input {...form.register('note')} autoComplete="off" />
            </Field>
          </div>
          <dl className="grid min-w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-small">
            <dt className="text-muted">{t('footer.subtotal')}</dt>
            <dd className="text-right">
              <MoneyText paise={subtotal} />
            </dd>
            <dt className="text-muted">{t('footer.extra')}</dt>
            <dd className="text-right">
              <MoneyText paise={extraPaise} />
            </dd>
            <dt className="border-t-2 border-rule pt-2 font-medium">{t('footer.total')}</dt>
            <dd className="border-t-2 border-rule pt-2 text-right">
              <MoneyText paise={subtotal + extraPaise} size="total" />
            </dd>
          </dl>
        </section>

        <div className="flex gap-3">
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('submitting') : t('submit')}
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/purchases">{t('new.back')}</Link>
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

/** Rupees for the small "now" note under the preview, without pulling in a component for plain text. */
function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

/** Move keyboard focus to a cell of the grid. */
function focusCell(row: number, cell: number): void {
  const name = CELLS[cell];
  const target = document.querySelector<HTMLElement>(`[data-cell="${name}-${row}"]`);
  (target?.matches('input') ? target : target?.querySelector('input'))?.focus();
}

/** After a line is removed, the picked products of the lines below move up one. */
function reindexAfterRemoval(
  picked: Record<number, Product | null>,
  removed: number,
): Record<number, Product | null> {
  const next: Record<number, Product | null> = {};
  for (const [key, value] of Object.entries(picked)) {
    const index = Number(key);
    if (index < removed) next[index] = value;
    else if (index > removed) next[index - 1] = value;
  }
  return next;
}
