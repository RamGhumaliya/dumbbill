'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Checkbox, Dialog, Field, Input, useToast } from '@/components/ui';
import { getBrowserApiClient, teamApi } from '@/lib/api';
import type { Role, TeamOptions } from '@/lib/api/schemas/team';
import { useApiForm } from '@/lib/forms/use-api-form';
import type { FailureView } from '../business/business-errors';
import { PermissionPicker } from './permission-picker';
import { describeTeamFailure } from './team-errors';
import { bpToPercentText, percentTextToBp } from './team-helpers';

type TeamT = ReturnType<typeof useTranslations<'Team'>>;

function buildSchema(t: TeamT) {
  return z.object({
    name: z.string().trim().min(2, t('validation.nameRequired')).max(50),
    description: z.string().trim().max(200),
    discountPercent: z
      .string()
      .refine((value) => typeof percentTextToBp(value) === 'number', t('validation.percent')),
  });
}

/**
 * Add a role, or edit one, in a dialog. A role is a named bundle of abilities (and a discount limit and a branch rule)
 * that can be given to several people at once. The built-in Admin and Cashier roles can be edited but keep their names;
 * the Owner role is never offered here. The server decides what the person making the change may include (nobody puts
 * an ability in a role that they do not hold themselves) and its refusal is shown in words.
 */
export function RoleDialog({
  role,
  options,
  onClose,
}: {
  /** The role to edit, or null to add a new one. */
  role: Role | null;
  options: TeamOptions;
  onClose: () => void;
}) {
  const t = useTranslations('Team');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const schema = useMemo(() => buildSchema(t), [t]);
  const builtIn = role?.systemKey !== null && role?.systemKey !== undefined;
  const form = useApiForm(schema, {
    defaultValues: {
      name: role?.name ?? '',
      description: role?.description ?? '',
      discountPercent: bpToPercentText(role?.discountLimitBp ?? 0),
    },
  });
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(role?.permissions ?? []));
  const [allBranches, setAllBranches] = useState(role?.allBranches ?? false);
  const [failure, setFailure] = useState<FailureView | null>(null);

  const save = useMutation({
    mutationFn: (values: z.output<typeof schema>) => {
      const body = {
        ...(builtIn ? {} : { name: values.name }),
        description: values.description,
        permissions: [...ticked].sort(),
        discountLimitBp: percentTextToBp(values.discountPercent) as number,
        allBranches,
      };
      const client = getBrowserApiClient();
      return role
        ? teamApi.updateRole(client, role.id, body)
        : teamApi.createRole(client, { ...body, name: values.name });
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      toast({ title: role ? t('roles.toast.saved') : t('roles.toast.created'), tone: 'success' });
      onClose();
    } catch (error) {
      if (form.applyServerErrors(error)) return;
      setFailure(
        describeTeamFailure(error, {
          title: t('errors.title'),
          network: t('errors.network'),
          forbidden: t('errors.forbidden'),
          generic: t('errors.generic'),
        }),
      );
    }
  });
  const errors = form.formState.errors;
  const busy = form.formState.isSubmitting;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={role ? t('role.editTitle', { name: role.name }) : t('role.addTitle')}
      description={t('role.description')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('role.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={onSubmit}>
            {busy ? t('role.saving') : role ? t('role.save') : t('role.create')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-h-96 flex-col gap-4 overflow-y-auto pr-1"
      >
        {failure && (
          <Alert tone="danger" title={failure.title}>
            {failure.body}
            {failure.reference && (
              <span className="mt-1 block font-mono text-caption">{failure.reference}</span>
            )}
          </Alert>
        )}
        <Field
          label={t('role.name')}
          hint={builtIn ? t('role.nameFixed') : undefined}
          error={errors.name?.message}
          required
        >
          <Input {...form.register('name')} readOnly={builtIn} autoComplete="off" />
        </Field>
        <Field label={t('role.about')} error={errors.description?.message}>
          <Input {...form.register('description')} autoComplete="off" />
        </Field>
        <Field
          label={t('role.discount')}
          hint={t('role.discountHint')}
          error={errors.discountPercent?.message}
          className="max-w-48"
        >
          <Input {...form.register('discountPercent')} inputMode="decimal" autoComplete="off" />
        </Field>
        <Checkbox
          label={t('role.allBranches')}
          description={t('role.allBranchesHint')}
          checked={allBranches}
          onCheckedChange={(state) => setAllBranches(state === true)}
        />
        <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
          <legend className="text-body font-medium">{t('role.permissions')}</legend>
          <PermissionPicker
            idPrefix="role"
            catalogue={options.permissions}
            value={ticked}
            onChange={setTicked}
            disabled={busy}
          />
        </fieldset>
        {/* Pressing Enter in a box submits, like the button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('role.save')}
        </button>
      </form>
    </Dialog>
  );
}
