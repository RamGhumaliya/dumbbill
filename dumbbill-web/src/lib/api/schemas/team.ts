import { z } from 'zod';

/**
 * Shapes of the Team & Permissions endpoints, written from the backend's Swagger manual (tag "Team") and
 * `docs/api/team-and-permissions.md`. If the backend changes one of these, the checks fail with a clear message here
 * instead of silently breaking a screen.
 *
 * Permission keys are plain strings here on purpose: the list of keys and their wording come from the server
 * (`GET /v1/team/options` -> `permissions[]`), so a new permission appears on the screens without a web release.
 */

/** A role: a named bundle of permissions. */
export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** OWNER, ADMIN or CASHIER for the built-in roles; null for roles the business made. */
  systemKey: z.string().nullable(),
  /** True for the Owner role: it holds every permission and cannot be edited. */
  locked: z.boolean(),
  permissions: z.array(z.string()),
  /** Largest discount it may give alone, in basis points (500 = 5%). */
  discountLimitBp: z.number().int(),
  allBranches: z.boolean(),
  memberCount: z.number().int(),
});
export type Role = z.infer<typeof roleSchema>;

export const roleListSchema = z.object({ roles: z.array(roleSchema) });

/** What a person can really do: role + extras - taken away. */
export const effectiveAccessSchema = z.object({
  permissions: z.array(z.string()),
  discountLimitBp: z.number().int(),
  allBranches: z.boolean(),
});

export const memberStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DISABLED']);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

/** One person on the team. Never carries a password, PIN or token. */
export const memberSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  status: memberStatusSchema,
  isOwner: z.boolean(),
  role: z.object({ id: z.string(), name: z.string() }).nullable(),
  branchIds: z.array(z.string()),
  extraPermissions: z.array(z.string()),
  deniedPermissions: z.array(z.string()),
  /** Their own discount limit, or null to use the role's. */
  discountLimitBp: z.number().int().nullable(),
  effective: effectiveAccessSchema,
  hasPin: z.boolean(),
  totpEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberListSchema = z.object({ members: z.array(memberSchema) });

/** One entry of the permission catalogue, with the wording to show. */
export const permissionInfoSchema = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  description: z.string(),
  /** True if it reveals cost or profit. */
  confidential: z.boolean(),
});
export type PermissionInfo = z.infer<typeof permissionInfoSchema>;

/** Everything the team forms need, in one call. */
export const teamOptionsSchema = z.object({
  roles: z.array(roleSchema),
  branches: z.array(z.object({ id: z.string(), name: z.string() })),
  permissions: z.array(permissionInfoSchema),
  seats: z.object({ max: z.number().int(), used: z.number().int() }),
});
export type TeamOptions = z.infer<typeof teamOptionsSchema>;

/** What the invite form sends. */
export interface InviteMemberInput {
  email: string;
  fullName: string;
  roleId: string;
  branchIds?: string[];
  extraPermissions?: string[];
  deniedPermissions?: string[];
  discountLimitBp?: number;
}

/** What the person form sends when changing someone. Only the fields that changed need to be present. */
export interface UpdateMemberInput {
  fullName?: string;
  roleId?: string;
  branchIds?: string[];
  extraPermissions?: string[];
  deniedPermissions?: string[];
  /** A number, or null to go back to the role's limit. */
  discountLimitBp?: number | null;
}

/** What the role form sends. */
export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
  discountLimitBp: number;
  allBranches: boolean;
}
