import { z } from 'zod';

/**
 * Shapes of the business-profile and branch endpoints, written from the backend's Swagger manual
 * (http://localhost:3000/docs, tags "Tenants & Business" and "Branches"). If the backend changes one of these, the
 * checks fail with a clear message here instead of silently breaking a screen.
 */

/** A GST state for the state picker. `code` is the two-digit GST code, for example "27" for Maharashtra. */
export const gstStateSchema = z.object({
  code: z.string(),
  name: z.string(),
  isUnionTerritory: z.boolean(),
});
export type GstState = z.infer<typeof gstStateSchema>;

export const gstStateListSchema = z.object({ states: z.array(gstStateSchema) });

/** The business profile. Every optional field is null when not given. */
export const businessProfileSchema = z.object({
  name: z.string(),
  gstin: z.string().nullable(),
  stateCode: z.string().nullable(),
  stateName: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  pincode: z.string().nullable(),
  phone: z.string().nullable(),
  hasLogo: z.boolean(),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

/** What the profile form sends (PUT /v1/business). Blank optional fields are sent as null. */
export interface BusinessProfileInput {
  name: string;
  stateCode: string;
  gstin: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
}

/** The first-steps checklist: each step is done when real data proves it. More steps arrive with later modules. */
export const onboardingSchema = z.object({
  steps: z.array(
    z.object({
      key: z.enum(['PROFILE', 'BRANCH', 'PRODUCTS', 'SUPPLIER', 'PURCHASE', 'TEAM']),
      done: z.boolean(),
    }),
  ),
  gstinMissing: z.boolean(),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  invoicePrefix: z.string(),
  printerWidthMm: z.union([z.literal(58), z.literal(80)]),
  stateCode: z.string().nullable(),
  stateName: z.string().nullable(),
  gstin: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  pincode: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Branch = z.infer<typeof branchSchema>;

/** The branches the person may use, and how many active branches the plan allows. */
export const branchListSchema = z.object({
  branches: z.array(branchSchema),
  limit: z.object({ max: z.number().int(), used: z.number().int() }),
});
export type BranchList = z.infer<typeof branchListSchema>;

/** What the branch form sends (POST /v1/branches and PUT /v1/branches/:id). */
export interface BranchInput {
  name: string;
  invoicePrefix: string;
  printerWidthMm: 58 | 80;
  stateCode: string;
  gstin: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
}

/** A downloaded file, such as the logo image. */
export const blobSchema = z.instanceof(Blob);
