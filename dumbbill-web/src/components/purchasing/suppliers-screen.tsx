'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  MoneyText,
  Select,
  useToast,
  type DataColumn,
} from '@/components/ui';
import { ApiError, getBrowserApiClient, inventoryApi } from '@/lib/api';
import type { Supplier } from '@/lib/api/schemas/inventory';
import { useApiForm } from '@/lib/forms/use-api-form';
import { describeFailure, type FailureView } from '../business/business-errors';
import { blankToNull, tidyGstin } from '../business/place';

type SuppliersT = ReturnType<typeof useTranslations<'Suppliers'>>;

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function buildSchema(t: SuppliersT) {
  return z.object({
    name: z.string().trim().min(2, t('validation.nameRequired')).max(120),
    gstin: z
      .string()
      .transform(tidyGstin)
      .refine((value) => value === '' || GSTIN_SHAPE.test(value), t('validation.gstinShape')),
    phone: z
      .string()
      .transform((value) => value.replace(/[\s\-()]/g, ''))
      .refine((value) => value === '' || /^\+?[0-9]{8,14}$/.test(value), t('validation.phone')),
    email: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        t('validation.email'),
      ),
    addressLine: z.string().trim().max(200),
    city: z.string().trim().max(80),
    notes: z.string().trim().max(500),
  });
}

/**
 * The add / edit form for one supplier, in a dialog. A GSTIN is optional; its shape is checked here and its check
 * character by the server (shown under the box). A name another supplier already has comes back as a message under the name.
 */
function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const t = useTranslations('Suppliers');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const schema = useMemo(() => buildSchema(t), [t]);
  const form = useApiForm(schema, {
    defaultValues: {
      name: supplier?.name ?? '',
      gstin: supplier?.gstin ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      addressLine: supplier?.addressLine ?? '',
      city: supplier?.city ?? '',
      notes: supplier?.notes ?? '',
    },
  });
  const [failure, setFailure] = useState<FailureView | null>(null);

  const save = useMutation({
    mutationFn: (values: z.output<typeof schema>) => {
      const body = {
        name: values.name,
        gstin: blankToNull(values.gstin),
        phone: blankToNull(values.phone),
        email: blankToNull(values.email),
        addressLine: blankToNull(values.addressLine),
        city: blankToNull(values.city),
        notes: blankToNull(values.notes),
      };
      const client = getBrowserApiClient();
      return supplier
        ? inventoryApi.updateSupplier(client, supplier.id, body)
        : inventoryApi.createSupplier(client, body);
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      await queryClient.invalidateQueries({ queryKey: ['business', 'onboarding'] });
      toast({ title: supplier ? t('toast.saved') : t('toast.created'), tone: 'success' });
      onClose();
    } catch (error) {
      if (form.applyServerErrors(error)) return;
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
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={supplier ? t('form.editTitle', { name: supplier.name }) : t('form.addTitle')}
      description={t('form.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button variant="primary" loading={form.formState.isSubmitting} onClick={onSubmit}>
            {form.formState.isSubmitting ? t('form.saving') : t('form.save')}
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
        <Field label={t('form.name')} error={errors.name?.message} required>
          <Input {...form.register('name')} autoComplete="off" />
        </Field>
        <Field label={t('form.gstin')} hint={t('form.gstinHint')} error={errors.gstin?.message}>
          <Input
            {...form.register('gstin')}
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            className="font-mono uppercase"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.phone')} error={errors.phone?.message}>
            <Input {...form.register('phone')} type="tel" autoComplete="off" />
          </Field>
          <Field label={t('form.email')} error={errors.email?.message}>
            <Input {...form.register('email')} type="email" autoComplete="off" />
          </Field>
        </div>
        <Field label={t('form.addressLine')} error={errors.addressLine?.message}>
          <Input {...form.register('addressLine')} autoComplete="off" />
        </Field>
        <Field label={t('form.city')} error={errors.city?.message}>
          <Input {...form.register('city')} autoComplete="off" />
        </Field>
        <Field label={t('form.notes')} hint={t('form.notesHint')} error={errors.notes?.message}>
          <Input {...form.register('notes')} autoComplete="off" />
        </Field>
        {/* Pressing Enter in a box submits, like the button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('form.save')}
        </button>
      </form>
    </Dialog>
  );
}

/**
 * The suppliers screen: who the shop buys from, and what it owes each (bills minus debit-note credit; payments are not
 * recorded yet, which the screen says). Switching a supplier off keeps its history; suppliers are never deleted.
 * Everything here needs `purchases.write`; without it the server answers 403 and the screen says so.
 */
export function SuppliersScreen() {
  const t = useTranslations('Suppliers');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [failure, setFailure] = useState<FailureView | null>(null);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const list = useQuery({
    queryKey: ['suppliers', 'list', { q, status }],
    queryFn: () => inventoryApi.listSuppliers(getBrowserApiClient(), { q: q || undefined, status }),
    placeholderData: (previous) => previous,
  });

  const toggle = useMutation({
    mutationFn: ({ supplier, on }: { supplier: Supplier; on: boolean }) =>
      on
        ? inventoryApi.activateSupplier(getBrowserApiClient(), supplier.id)
        : inventoryApi.deactivateSupplier(getBrowserApiClient(), supplier.id),
    onSuccess: async (_saved, { on }) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast({ title: on ? t('toast.on') : t('toast.off'), tone: 'success' });
    },
    onError: (error) =>
      setFailure(
        describeFailure(error, {
          title: t('errors.title'),
          network: t('errors.network'),
          forbidden: t('errors.forbidden'),
          generic: t('errors.generic'),
        }),
      ),
  });

  if (list.isError && !list.data) {
    const denied = list.error instanceof ApiError && list.error.code === 'FORBIDDEN';
    return (
      <Alert tone="danger" title={denied ? t('errors.forbidden') : t('loadFailed')}>
        {!denied && (
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            {t('retry')}
          </Button>
        )}
      </Alert>
    );
  }

  const rows = list.data ?? [];
  const columns: DataColumn<Supplier>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      value: (supplier) => supplier.name,
      sortable: true,
      cell: (supplier) => (
        <span className="flex flex-col">
          <span className="font-medium">{supplier.name}</span>
          {supplier.city && <span className="text-caption text-muted">{supplier.city}</span>}
        </span>
      ),
    },
    {
      id: 'gstin',
      header: t('columns.gstin'),
      value: (supplier) => supplier.gstin ?? '',
      mono: true,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      value: (supplier) => supplier.phone ?? '',
      mono: true,
    },
    {
      id: 'owed',
      header: t('columns.owed'),
      value: (supplier) => supplier.balancePaise,
      align: 'right',
      sortable: true,
      cell: (supplier) => <MoneyText paise={supplier.balancePaise} />,
    },
    {
      id: 'status',
      header: t('columns.status'),
      value: (supplier) => (supplier.isActive ? 1 : 0),
      cell: (supplier) => (
        <Badge variant={supplier.isActive ? 'success' : 'neutral'}>
          {supplier.isActive ? t('status.active') : t('status.off')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      align: 'right',
      value: () => null,
      cell: (supplier) => (
        <span className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('editLabel', { name: supplier.name })}
            onClick={() => setEditing(supplier)}
          >
            {t('edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={
              supplier.isActive
                ? t('switchOffLabel', { name: supplier.name })
                : t('switchOnLabel', { name: supplier.name })
            }
            onClick={() => {
              setFailure(null);
              toggle.mutate({ supplier, on: !supplier.isActive });
            }}
          >
            {supplier.isActive ? t('switchOff') : t('switchOn')}
          </Button>
        </span>
      ),
    },
  ];

  const filtered = q !== '' || status !== 'active';
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('search')} className="min-w-56 flex-1">
          <Input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
          />
        </Field>
        <Field label={t('show')} className="w-56">
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as 'active' | 'inactive' | 'all')}
            options={[
              { value: 'active', label: t('filters.active') },
              { value: 'inactive', label: t('filters.inactive') },
              { value: 'all', label: t('filters.all') },
            ]}
          />
        </Field>
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('add')}
        </Button>
      </div>
      <p className="text-caption text-muted">{t('owedNote')}</p>
      {failure && (
        <Alert tone="danger" title={failure.title}>
          {failure.body}
        </Alert>
      )}
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={rows}
        getRowId={(supplier) => supplier.id}
        loading={list.isPending}
        density="comfortable"
        empty={
          <EmptyState
            title={filtered ? t('empty.filtered') : t('empty.title')}
            description={filtered ? undefined : t('empty.body')}
          />
        }
      />
      {editing && (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
