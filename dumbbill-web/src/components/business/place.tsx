'use client';

import { Controller, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { Field, Input, Select } from '@/components/ui';
import type { GstState } from '@/lib/api/schemas/business';

/**
 * The address, state, GSTIN and phone fields that the business profile and every branch share, with their rules.
 *
 * Why shared: both places are "a registered place of business" in GST terms, and the server applies the same checks
 * to both (state must be a real GST state, GSTIN shape, GSTIN starts with the state code). One definition keeps the
 * two screens from drifting apart.
 *
 * The browser only checks the SHAPE of a GSTIN (15 letters and digits). The check character and the state match are
 * verified by the server, which answers with a message shown under the GSTIN box.
 */

/** The wording for each rule. Both screens pass their own (they live in different parts of messages/en.json). */
export interface PlaceMessages {
  stateRequired: string;
  gstinShape: string;
  pincode: string;
  phone: string;
  addressTooLong: string;
  cityTooLong: string;
}

/** The values shared by both forms. Optional text is an empty string while typing and becomes null when sent. */
export interface PlaceValues {
  stateCode: string;
  gstin: string;
  addressLine: string;
  city: string;
  pincode: string;
  phone: string;
}

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** A GSTIN as typed: spaces removed, upper case. Blank stays blank. */
export function tidyGstin(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Zod rules for the shared fields. Add to your own `z.object({ ... })`. */
export function placeShape(messages: PlaceMessages) {
  return {
    stateCode: z.string().regex(/^[0-9]{2}$/, messages.stateRequired),
    gstin: z
      .string()
      .transform(tidyGstin)
      .refine((value) => value === '' || GSTIN_SHAPE.test(value), messages.gstinShape),
    addressLine: z.string().trim().max(200, messages.addressTooLong),
    city: z.string().trim().max(80, messages.cityTooLong),
    pincode: z
      .string()
      .trim()
      .refine((value) => value === '' || /^[1-9][0-9]{5}$/.test(value), messages.pincode),
    phone: z
      .string()
      .transform((value) => value.replace(/[\s\-()]/g, ''))
      .refine((value) => value === '' || /^\+?[0-9]{8,14}$/.test(value), messages.phone),
  };
}

/** What the API expects for an optional text: the text, or null when blank. */
export function blankToNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/** Form values from what the API returned (null becomes an empty box). */
export function placeDefaults(place: {
  stateCode: string | null;
  gstin: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
}): PlaceValues {
  return {
    stateCode: place.stateCode ?? '',
    gstin: place.gstin ?? '',
    addressLine: place.addressLine ?? '',
    city: place.city ?? '',
    pincode: place.pincode ?? '',
    phone: place.phone ?? '',
  };
}

/** Labels and hints for the shared fields. */
export interface PlaceLabels {
  stateCode: string;
  statePlaceholder: string;
  stateHint: string;
  gstin: string;
  gstinHint: string;
  addressLine: string;
  city: string;
  pincode: string;
  phone: string;
  phoneHint?: string;
}

/**
 * The shared fields. Must be rendered inside a `<FormProvider>` whose values include `PlaceValues`; it reads the form
 * from context so the same component serves both forms.
 */
export function PlaceFields({
  states,
  labels,
  disabled = false,
}: {
  states: readonly GstState[];
  labels: PlaceLabels;
  disabled?: boolean;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<PlaceValues>();

  return (
    <>
      <Field
        label={labels.stateCode}
        hint={labels.stateHint}
        error={errors.stateCode?.message}
        required
      >
        <Controller
          control={control}
          name="stateCode"
          render={({ field }) => (
            <Select
              name={field.name}
              value={field.value === '' ? undefined : field.value}
              onValueChange={field.onChange}
              placeholder={labels.statePlaceholder}
              disabled={disabled}
              options={states.map((state) => ({
                value: state.code,
                label: `${state.name} (${state.code})`,
              }))}
            />
          )}
        />
      </Field>
      <Field label={labels.gstin} hint={labels.gstinHint} error={errors.gstin?.message}>
        <Input
          {...register('gstin')}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          className="font-mono uppercase"
        />
      </Field>
      <Field label={labels.addressLine} error={errors.addressLine?.message}>
        <Input {...register('addressLine')} disabled={disabled} autoComplete="street-address" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={labels.city} error={errors.city?.message}>
          <Input {...register('city')} disabled={disabled} autoComplete="address-level2" />
        </Field>
        <Field label={labels.pincode} error={errors.pincode?.message}>
          <Input
            {...register('pincode')}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            className="font-mono"
          />
        </Field>
      </div>
      <Field label={labels.phone} hint={labels.phoneHint} error={errors.phone?.message}>
        <Input {...register('phone')} disabled={disabled} type="tel" autoComplete="tel" />
      </Field>
    </>
  );
}
