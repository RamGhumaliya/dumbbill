'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Dialog, Field, Input, Select, useToast } from '@/components/ui';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
  type StockRow,
} from '@/lib/api/schemas/inventory';
import { describeFailure, type FailureView } from '../business/business-errors';

const WHOLE = /^[0-9]{1,7}$/;

/**
 * "I counted this many" (journey J5), plus the product's low-stock level, in one small dialog.
 *
 * Saving does up to two things: if the counted quantity differs from the books it records the difference with the chosen
 * reason (the server removes or adds units at the average cost and writes the before and after to the audit log); if the
 * low-stock level changed it saves that. A count that equals the books is simply skipped, so the dialog can be used just to
 * set the alert level. One Idempotency-Key per opening makes a retry safe.
 */
export function CountDialog({
  branchId,
  row,
  canAdjust,
  onClose,
}: {
  branchId: string;
  row: StockRow;
  canAdjust: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('Stock');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState(String(row.qty));
  const [reason, setReason] = useState<AdjustmentReason>('RECOUNT');
  const [note, setNote] = useState('');
  const [level, setLevel] = useState(row.minQty === null ? '' : String(row.minQty));
  const [errors, setErrors] = useState<{ counted?: string; level?: string }>({});
  const [failure, setFailure] = useState<FailureView | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const save = useMutation({
    mutationFn: async () => {
      const countedQty = Number(counted);
      let changed = false;
      if (countedQty !== row.qty) {
        await inventoryApi.adjustStock(
          getBrowserApiClient(),
          {
            branchId,
            productId: row.productId,
            countedQty,
            reason,
            note: note.trim() === '' ? null : note.trim(),
          },
          idempotencyKey,
        );
        changed = true;
      }
      const newLevel = level.trim() === '' ? null : Number(level);
      if (newLevel !== null && newLevel !== row.minQty) {
        await inventoryApi.setLowStockLevel(getBrowserApiClient(), {
          branchId,
          productId: row.productId,
          minQty: newLevel,
        });
        changed = true;
      }
      return changed;
    },
  });

  const submit = async () => {
    const next: { counted?: string; level?: string } = {};
    if (!WHOLE.test(counted)) next.counted = t('validation.qtyRequired');
    if (level.trim() !== '' && !WHOLE.test(level)) next.level = t('validation.level');
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) return;
    try {
      const changed = await save.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast({
        title: changed ? t('countDialog.saved') : t('countDialog.nothingToSave'),
        tone: changed ? 'success' : 'neutral',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'IDEMPOTENCY_KEY_REUSED') {
        setFailure({ title: t('errors.title'), body: t('errors.keyReused') });
        return;
      }
      if (error instanceof ApiError && error.code === 'BUSINESS_RULE_VIOLATION') {
        setErrors({ counted: t('countDialog.matches') });
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
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('countDialog.title', { name: row.productName })}
      description={t('countDialog.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ledger.close')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {t('countDialog.save')}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
            {failure.reference && (
              <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
            )}
          </Alert>
        )}
        {canAdjust && (
          <>
            <p className="text-small text-muted">{t('countDialog.current', { qty: row.qty })}</p>
            <Field label={t('countDialog.counted')} error={errors.counted} required>
              <Input
                value={counted}
                onChange={(event) => setCounted(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field label={t('countDialog.reason')}>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as AdjustmentReason)}
                options={ADJUSTMENT_REASONS.map((value) => ({
                  value,
                  label: t(`reasons.${value}`),
                }))}
              />
            </Field>
            <Field label={t('countDialog.note')}>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </>
        )}
        <Field
          label={t('countDialog.level')}
          hint={t('countDialog.levelHint')}
          error={errors.level}
        >
          <Input
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        {/* Pressing Enter in a box submits, like the button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('countDialog.save')}
        </button>
      </form>
    </Dialog>
  );
}
