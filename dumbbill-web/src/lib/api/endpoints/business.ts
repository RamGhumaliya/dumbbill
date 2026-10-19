import type { ApiClient } from '../client';
import { noContentSchema } from '../schemas/auth';
import {
  blobSchema,
  branchListSchema,
  branchSchema,
  businessProfileSchema,
  gstStateListSchema,
  onboardingSchema,
  type Branch,
  type BranchInput,
  type BranchList,
  type BusinessProfile,
  type BusinessProfileInput,
  type GstState,
  type Onboarding,
} from '../schemas/business';

/**
 * Business profile, branch and first-steps endpoints: one function per endpoint, named exactly like the operationId
 * in the Swagger manual. Reading is open to every signed-in person; changing needs `settings.manage` (the API enforces
 * it; screens only hide what the person cannot do).
 */

/** operationId getBusinessProfile. Permission: any signed-in user. */
export function getBusinessProfile(client: ApiClient): Promise<BusinessProfile> {
  return client.request({ path: '/v1/business', schema: businessProfileSchema });
}

/** operationId updateBusinessProfile. Permission: settings.manage. Replaces the whole profile. */
export function updateBusinessProfile(
  client: ApiClient,
  body: BusinessProfileInput,
): Promise<BusinessProfile> {
  return client.request({
    method: 'PUT',
    path: '/v1/business',
    body,
    schema: businessProfileSchema,
  });
}

/** operationId listGstStates. Permission: any signed-in user. Sorted by name. */
export async function listGstStates(client: ApiClient): Promise<GstState[]> {
  const result = await client.request({
    path: '/v1/business/gst-states',
    schema: gstStateListSchema,
  });
  return result.states;
}

/** operationId getOnboardingChecklist. Permission: settings.manage. */
export function getOnboardingChecklist(client: ApiClient): Promise<Onboarding> {
  return client.request({ path: '/v1/business/onboarding', schema: onboardingSchema });
}

/** operationId uploadBusinessLogo. Permission: settings.manage. PNG, JPEG or WebP, up to 2 MB. */
export function uploadBusinessLogo(client: ApiClient, file: File): Promise<BusinessProfile> {
  const form = new FormData();
  form.append('file', file);
  return client.request({
    method: 'PUT',
    path: '/v1/business/logo',
    body: form,
    schema: businessProfileSchema,
  });
}

/** operationId getBusinessLogo. Permission: any signed-in user. The image needs the token, so it is fetched as a Blob. */
export function getBusinessLogo(client: ApiClient): Promise<Blob> {
  return client.request({ path: '/v1/business/logo', expect: 'blob', schema: blobSchema });
}

/** operationId removeBusinessLogo. Permission: settings.manage. */
export function removeBusinessLogo(client: ApiClient): Promise<void> {
  return client.request({ method: 'DELETE', path: '/v1/business/logo', schema: noContentSchema });
}

/** operationId listBranches. Permission: any signed-in user (only the branches they may use). */
export function listBranches(client: ApiClient): Promise<BranchList> {
  return client.request({ path: '/v1/branches', schema: branchListSchema });
}

/** operationId getBranch. Permission: any signed-in user (404 outside the business, 403 outside their branches). */
export function getBranch(client: ApiClient, branchId: string): Promise<Branch> {
  return client.request({ path: `/v1/branches/${branchId}`, schema: branchSchema });
}

/** operationId createBranch. Permission: settings.manage. Fails with PLAN_LIMIT_REACHED at the plan's branch limit. */
export function createBranch(client: ApiClient, body: BranchInput): Promise<Branch> {
  return client.request({ method: 'POST', path: '/v1/branches', body, schema: branchSchema });
}

/** operationId updateBranch. Permission: settings.manage. Replaces all details of the branch. */
export function updateBranch(
  client: ApiClient,
  branchId: string,
  body: BranchInput,
): Promise<Branch> {
  return client.request({
    method: 'PUT',
    path: `/v1/branches/${branchId}`,
    body,
    schema: branchSchema,
  });
}

/** operationId deactivateBranch. Permission: settings.manage. The last active branch cannot be switched off. */
export function deactivateBranch(client: ApiClient, branchId: string): Promise<Branch> {
  return client.request({
    method: 'POST',
    path: `/v1/branches/${branchId}/deactivate`,
    schema: branchSchema,
  });
}

/** operationId activateBranch. Permission: settings.manage. Counts against the plan's branch limit. */
export function activateBranch(client: ApiClient, branchId: string): Promise<Branch> {
  return client.request({
    method: 'POST',
    path: `/v1/branches/${branchId}/activate`,
    schema: branchSchema,
  });
}
