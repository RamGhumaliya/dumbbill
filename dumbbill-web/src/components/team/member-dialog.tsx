'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Checkbox, Dialog, Field, Input, Select, useToast } from '@/components/ui';
import { getBrowserApiClient, teamApi } from '@/lib/api';
import type { Member, TeamOptions } from '@/lib/api/schemas/team';
import { useApiForm } from '@/lib/forms/use-api-form';
import type { FailureView } from '../business/business-errors';
import { PermissionPicker } from './permission-picker';
import { describeTeamFailure } from './team-errors';
import { bpToPercentText, diffFromRole, percentTextToBp } from './team-helpers';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type TeamT = ReturnType<typeof useTranslations<'Team'>>;

function buildSchema(t: TeamT, inviting: boolean) {
  return z.object({
    fullName: z.string().trim().min(2, t('validation.nameRequired')).max(100),
    // Only asked when inviting; an existing person's address is their sign-in name and never changes.
    email: inviting
      ? z
          .string()
          .trim()
          .min(1, t('validation.emailRequired'))
          .regex(EMAIL_SHAPE, t('validation.emailShape'))
          // The server stores addresses in lower case; do the same here so what we show matches what is saved.
          .transform((value) => value.toLowerCase())
      : z.string(),
    roleId: z.string().min(1, t('validation.roleRequired')),
    discountPercent: z
      .string()
      .refine((value) => percentTextToBp(value) !== 'invalid', t('validation.percent')),
  });
}

/**
 * Invite a person, or change one, in a dialog.
 *
 * THE ABILITIES LIST shows the FINAL result as plain tick boxes (what the person will be able to do). It starts from the
 * chosen role; unticking something the role gives takes it away from this person only, and ticking something the role
 * lacks gives it as an extra. On save the difference to the role is sent as "extras" and "taken away", which is how the
 * server stores a person's access (role + extras - taken away). Changing the role starts the list again from that role.
 *
 * BRANCHES are asked only when the role works in assigned branches. The server decides what the person doing this may hand
 * out (nobody grants what they do not hold); its refusal is shown in words at the top of the dialog.
 */
export function MemberDialog({
  member,
  options,
  onClose,
}: {
  /** The person to edit, or null to invite a new one. */
  member: Member | null;
  options: TeamOptions;
  onClose: () => void;
}) {
  const t = useTranslations('Team');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inviting = member === null;
  const schema = useMemo(() => buildSchema(t, inviting), [t, inviting]);
  const roles = options.roles.filter((role) => role.systemKey !== 'OWNER');
  const roleById = new Map(options.roles.map((role) => [role.id, role]));

  const form = useApiForm(schema, {
    defaultValues: {
      fullName: member?.fullName ?? '',
      email: member?.email ?? '',
      roleId: member?.role?.id ?? '',
      discountPercent: bpToPercentText(member?.discountLimitBp ?? null),
    },
  });
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(member?.effective.permissions ?? []),
  );
  const [branchIds, setBranchIds] = useState<Set<string>>(() => new Set(member?.branchIds ?? []));
  const [failure, setFailure] = useState<FailureView | null>(null);

  const roleId = form.watch('roleId');
  const role = roleById.get(roleId);
  const rolePermissions = new Set(role?.permissions ?? []);

  const save = useMutation({
    mutationFn: (values: z.output<typeof schema>) => {
      const chosen = roleById.get(values.roleId);
      const { extra, denied } = diffFromRole(chosen?.permissions ?? [], ticked);
      const limit = percentTextToBp(values.discountPercent);
      const client = getBrowserApiClient();
      const branches = chosen?.allBranches ? [] : [...branchIds];
      if (member) {
        return teamApi.updateMember(client, member.id, {
          fullName: values.fullName,
          roleId: values.roleId,
          branchIds: branches,
          extraPermissions: extra,
          deniedPermissions: denied,
          discountLimitBp: limit === 'invalid' ? null : limit,
        });
      }
      return teamApi.inviteMember(client, {
        email: values.email,
        fullName: values.fullName,
        roleId: values.roleId,
        branchIds: branches,
        extraPermissions: extra,
        deniedPermissions: denied,
        ...(typeof limit === 'number' ? { discountLimitBp: limit } : {}),
      });
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      await queryClient.invalidateQueries({ queryKey: ['business', 'onboarding'] });
      toast({
        title: inviting
          ? t('people.toast.invited', { email: values.email })
          : t('people.toast.saved'),
        tone: 'success',
      });
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

  const chooseRole = (nextId: string) => {
    form.setValue('roleId', nextId, { shouldValidate: true, shouldDirty: true });
    // A new role starts the abilities list again from what that role gives.
    setTicked(new Set(roleById.get(nextId)?.permissions ?? []));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={inviting ? t('member.inviteTitle') : t('member.editTitle', { name: member.fullName })}
      description={t('member.description')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('member.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={onSubmit}>
            {inviting
              ? busy
                ? t('member.sending')
                : t('member.send')
              : busy
                ? t('member.saving')
                : t('member.save')}
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
        {member?.status === 'INVITED' && (
          <Alert tone="info" title={t('member.invitedTitle')}>
            {t('member.invitedNote')}
          </Alert>
        )}
        <Field label={t('member.name')} error={errors.fullName?.message} required>
          <Input {...form.register('fullName')} autoComplete="off" />
        </Field>
        {inviting ? (
          <Field label={t('member.email')} error={errors.email?.message} required>
            <Input {...form.register('email')} type="email" autoComplete="off" />
          </Field>
        ) : (
          <Field label={t('member.email')} hint={t('member.emailFixed')}>
            <Input value={member.email} readOnly />
          </Field>
        )}
        <Field label={t('member.role')} error={errors.roleId?.message} required>
          <Controller
            control={form.control}
            name="roleId"
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={chooseRole}
                placeholder={t('member.rolePlaceholder')}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
          />
        </Field>

        {role && !role.allBranches && (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-body font-medium">{t('member.branches')}</legend>
            <p className="text-small text-muted">{t('member.branchesHint')}</p>
            {options.branches.map((branch) => (
              <Checkbox
                key={branch.id}
                label={branch.name}
                checked={branchIds.has(branch.id)}
                onCheckedChange={(state) => {
                  const next = new Set(branchIds);
                  if (state === true) next.add(branch.id);
                  else next.delete(branch.id);
                  setBranchIds(next);
                }}
              />
            ))}
            {branchIds.size === 0 && (
              <p className="text-small text-danger">{t('member.branchesNone')}</p>
            )}
          </fieldset>
        )}

        <Field
          label={t('member.discount')}
          hint={t('member.discountHint', {
            percent: bpToPercentText(role?.discountLimitBp ?? 0),
          })}
          error={errors.discountPercent?.message}
          className="max-w-48"
        >
          <Input {...form.register('discountPercent')} inputMode="decimal" autoComplete="off" />
        </Field>

        {role && (
          <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
            <legend className="text-body font-medium">{t('member.permissions')}</legend>
            <p className="text-small text-muted">{t('member.permissionsHint')}</p>
            <PermissionPicker
              idPrefix="member"
              catalogue={options.permissions}
              value={ticked}
              onChange={setTicked}
              fromRole={rolePermissions}
              disabled={busy}
            />
          </fieldset>
        )}
        {/* Pressing Enter in a box submits, like the button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('member.save')}
        </button>
      </form>
    </Dialog>
  );
}
