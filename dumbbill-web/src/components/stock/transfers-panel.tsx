'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  useToast,
  type DataColumn,
} from '@/components/ui';
import { CloseIcon } from '@/components/ui/icons';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { Branch } from '@/lib/api/schemas/business';
import type { Product } from '@/lib/api/schemas/products';
import type { Transfer } from '@/lib/api/schemas/inventory';
import { formatDateTime } from '@/lib/format/datetime';
import { describeFailure, type FailureView } from '../business/business-errors';
import { ProductPicker } from '../products/product-picker';

interface DraftLine {
  key: number;
  product: Product | null;
  qty: string;
}

/**
 * Send goods to another branch: the sending branch, the receiving branch, and the goods. The goods leave NOW and are in
 * transit until the other branch receives them. If a line asks for more than is on hand the server refuses the whole
 * transfer (INSUFFICIENT_STOCK) and nothing moves. One Idempotency-Key per opening makes a double tap send once.
 *
 * The receiving branch list is the branches this person may use; sending to a branch outside that list needs someone who
 * can use both.
 */
function NewTransferDialog({
  branches,
  defaultFromBranchId,
  onClose,
}: {
  branches: Branch[];
  defaultFromBranchId: string;
  onClose: () => void;
}) {
  const t = useTranslations('Stock');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const active = branches.filter((branch) => branch.isActive);
  const [from, setFrom] = useState(defaultFromBranchId);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const nextKey = useRef(1);
  const [lines, setLines] = useState<DraftLine[]>([{ key: 0, product: null, qty: '' }]);
  const [problem, setProblem] = useState<string | undefined>();
  const [failure, setFailure] = useState<FailureView | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const send = useMutation({
    mutationFn: () =>
      inventoryApi.createTransfer(
        getBrowserApiClient(),
        {
          fromBranchId: from,
          toBranchId: to,
          note: note.trim() === '' ? null : note.trim(),
          lines: lines.map((line) => ({
            productId: (line.product as Product).id,
            qty: Number(line.qty),
          })),
        },
        idempotencyKey.current,
      ),
  });

  const submit = async () => {
    setFailure(null);
    if (!to || to === from) {
      setProblem(t('transfers.form.sameBranch'));
      return;
    }
    if (lines.some((line) => !line.product || !/^[1-9][0-9]{0,6}$/.test(line.qty))) {
      setProblem(t('validation.productRequired'));
      return;
    }
    setProblem(undefined);
    try {
      await send.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast({ title: t('transfers.sent'), tone: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
        setFailure({
          title: t('errors.title'),
          body: t('transfers.form.insufficient', { detail: error.detail ?? '' }),
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
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('transfers.form.title')}
      description={t('transfers.form.description')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ledger.close')}
          </Button>
          <Button variant="primary" loading={send.isPending} onClick={() => void submit()}>
            {t('transfers.form.submit')}
          </Button>
        </>
      }
    >
      {active.length < 2 ? (
        <Alert tone="info" title={t('transfers.form.noOtherBranch')} />
      ) : (
        <div className="flex flex-col gap-4">
          {failure && (
            <Alert tone="danger" title={failure.title}>
              {failure.body}
              {failure.reference && (
                <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
              )}
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('transfers.form.from')} required>
              <Select
                value={from}
                onValueChange={setFrom}
                options={active.map((b) => ({ value: b.id, label: b.name }))}
              />
            </Field>
            <Field
              label={t('transfers.form.to')}
              error={problem === t('transfers.form.sameBranch') ? problem : undefined}
              required
            >
              <Select
                value={to === '' ? undefined : to}
                onValueChange={setTo}
                options={active
                  .filter((b) => b.id !== from)
                  .map((b) => ({ value: b.id, label: b.name }))}
              />
            </Field>
          </div>
          <Field label={t('transfers.form.note')}>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <ul className="flex flex-col gap-3">
            {lines.map((line, index) => (
              <li key={line.key} className="grid items-start gap-3 sm:grid-cols-[1fr_6rem_auto]">
                <ProductPicker
                  ariaLabel={`${t('transfers.form.product')}, ${index + 1}`}
                  onPick={(product) =>
                    setLines((all) =>
                      all.map((row) => (row.key === line.key ? { ...row, product } : row)),
                    )
                  }
                />
                <Input
                  value={line.qty}
                  aria-label={`${t('transfers.form.qty')}, ${index + 1}`}
                  inputMode="numeric"
                  autoComplete="off"
                  className="text-right font-mono"
                  onChange={(event) =>
                    setLines((all) =>
                      all.map((row) =>
                        row.key === line.key ? { ...row, qty: event.target.value } : row,
                      ),
                    )
                  }
                />
                <IconButton
                  label={t('transfers.form.removeRow', { number: index + 1 })}
                  size="sm"
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((row) => row.key !== line.key))}
                >
                  <CloseIcon />
                </IconButton>
              </li>
            ))}
          </ul>
          {problem && problem !== t('transfers.form.sameBranch') && (
            <p role="alert" className="text-caption font-medium text-danger">
              {problem}
            </p>
          )}
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setLines((all) => [...all, { key: nextKey.current, product: null, qty: '' }]);
                nextKey.current += 1;
              }}
            >
              {t('transfers.form.addRow')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Transfers between branches (US-STK-01, journey J5): the list with Receive and Cancel, and the "send goods" dialog.
 * While goods are in transit they are in neither branch's stock. The server decides who may receive (the receiving branch)
 * and who may cancel (the sending branch); a refusal is shown in words. Needs `stock.transfer`.
 */
export function TransfersPanel({
  branches,
  currentBranchId,
}: {
  branches: Branch[];
  currentBranchId: string;
}) {
  const t = useTranslations('Stock');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<FailureView | null>(null);
  const list = useQuery({
    queryKey: ['stock', 'transfers'],
    queryFn: () => inventoryApi.listTransfers(getBrowserApiClient()),
  });

  const act = useMutation({
    mutationFn: ({ transfer, action }: { transfer: Transfer; action: 'receive' | 'cancel' }) =>
      action === 'receive'
        ? inventoryApi.receiveTransfer(getBrowserApiClient(), transfer.id)
        : inventoryApi.cancelTransfer(getBrowserApiClient(), transfer.id),
    onSuccess: async (_saved, { action }) => {
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast({
        title: action === 'receive' ? t('transfers.received') : t('transfers.cancelled'),
        tone: 'success',
      });
    },
    onError: (error) => {
      setFailure(
        error instanceof ApiError && error.code === 'CONFLICT'
          ? { title: t('errors.title'), body: t('errors.conflict') }
          : describeFailure(error, {
              title: t('errors.title'),
              network: t('errors.network'),
              forbidden: t('errors.forbidden'),
              generic: t('errors.generic'),
            }),
      );
      void queryClient.invalidateQueries({ queryKey: ['stock', 'transfers'] });
    },
  });

  if (list.isPending)
    return (
      <p role="status" className="text-small text-muted">
        {t('transfers.loading')}
      </p>
    );
  if (list.isError) return <Alert tone="danger" title={t('transfers.loadFailed')} />;

  const columns: DataColumn<Transfer>[] = [
    {
      id: 'sent',
      header: t('transfers.columns.sent'),
      value: (row) => row.createdAt,
      sortable: true,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      id: 'route',
      header: t('transfers.columns.route'),
      value: (row) => row.fromBranchName,
      cell: (row) => t('transfers.route', { from: row.fromBranchName, to: row.toBranchName }),
    },
    {
      id: 'goods',
      header: t('transfers.columns.goods'),
      value: (row) => row.lines.length,
      cell: (row) =>
        t('transfers.goodsValue', {
          count: new Set(row.lines.map((line) => line.productId)).size,
          units: row.lines.reduce((sum, line) => sum + line.qty, 0),
        }),
    },
    {
      id: 'status',
      header: t('transfers.columns.status'),
      value: (row) => row.status,
      cell: (row) => (
        <Badge
          variant={
            row.status === 'IN_TRANSIT'
              ? 'warning'
              : row.status === 'RECEIVED'
                ? 'success'
                : 'neutral'
          }
        >
          {t(`transfers.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t('transfers.columns.actions'),
      align: 'right',
      value: () => null,
      cell: (row) =>
        row.status === 'IN_TRANSIT' ? (
          <span className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('transfers.receiveLabel', { from: row.fromBranchName })}
              onClick={() => {
                setFailure(null);
                act.mutate({ transfer: row, action: 'receive' });
              }}
            >
              {t('transfers.receive')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('transfers.cancelLabel', { to: row.toBranchName })}
              onClick={() => {
                setFailure(null);
                act.mutate({ transfer: row, action: 'cancel' });
              }}
            >
              {t('transfers.cancel')}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t('transfers.new')}
        </Button>
      </div>
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
        </Alert>
      )}
      <DataTable
        caption={t('transfers.caption')}
        columns={columns}
        rows={list.data}
        getRowId={(row) => row.id}
        density="comfortable"
        empty={
          <EmptyState title={t('transfers.empty.title')} description={t('transfers.empty.body')} />
        }
      />
      {creating && (
        <NewTransferDialog
          branches={branches}
          defaultFromBranchId={currentBranchId}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
