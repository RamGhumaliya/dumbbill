import type { ApiClient } from '../client';
import { noContentSchema } from '../schemas/auth';
import {
  memberListSchema,
  memberSchema,
  roleSchema,
  teamOptionsSchema,
  type InviteMemberInput,
  type Member,
  type Role,
  type RoleInput,
  type TeamOptions,
  type UpdateMemberInput,
} from '../schemas/team';

/**
 * Team & Permissions endpoints: one function per endpoint, named exactly like the operationId in the Swagger manual.
 * Everything here needs `team.manage`. The server enforces the "no escalation" rules (nobody grants what they do not
 * hold, nobody edits themselves or the owner); a refusal comes back as `FORBIDDEN` with a plain-English `detail`.
 */

/** operationId getTeamOptions. Permission: team.manage. Roles, branches, the permission catalogue and seats. */
export function getTeamOptions(client: ApiClient): Promise<TeamOptions> {
  return client.request({ path: '/v1/team/options', schema: teamOptionsSchema });
}

/** operationId listMembers. Permission: team.manage. */
export async function listMembers(client: ApiClient): Promise<Member[]> {
  const result = await client.request({ path: '/v1/team/members', schema: memberListSchema });
  return result.members;
}

/** operationId inviteMember. Permission: team.manage. The person gets an e-mail with a 7-day link. */
export function inviteMember(client: ApiClient, body: InviteMemberInput): Promise<Member> {
  return client.request({
    method: 'POST',
    path: '/v1/team/members',
    body,
    schema: memberSchema,
  });
}

/** operationId updateMember. Permission: team.manage. Branch, permission and extras lists REPLACE the old ones. */
export function updateMember(
  client: ApiClient,
  memberId: string,
  body: UpdateMemberInput,
): Promise<Member> {
  return client.request({
    method: 'PATCH',
    path: `/v1/team/members/${memberId}`,
    body,
    schema: memberSchema,
  });
}

/** operationId disableMember. Permission: team.manage. Their sessions end at once. */
export function disableMember(client: ApiClient, memberId: string): Promise<Member> {
  return client.request({
    method: 'POST',
    path: `/v1/team/members/${memberId}/disable`,
    schema: memberSchema,
  });
}

/** operationId enableMember. Permission: team.manage. Needs a free seat. */
export function enableMember(client: ApiClient, memberId: string): Promise<Member> {
  return client.request({
    method: 'POST',
    path: `/v1/team/members/${memberId}/enable`,
    schema: memberSchema,
  });
}

/** operationId resendInvitation. Permission: team.manage. Older links stop working. */
export function resendInvitation(client: ApiClient, memberId: string): Promise<void> {
  return client.request({
    method: 'POST',
    path: `/v1/team/members/${memberId}/resend-invitation`,
    schema: noContentSchema,
  });
}

/** operationId createRole. Permission: team.manage. */
export function createRole(client: ApiClient, body: RoleInput): Promise<Role> {
  return client.request({ method: 'POST', path: '/v1/team/roles', body, schema: roleSchema });
}

/** operationId updateRole. Permission: team.manage. The permission list REPLACES the old one. */
export function updateRole(
  client: ApiClient,
  roleId: string,
  body: Partial<RoleInput>,
): Promise<Role> {
  return client.request({
    method: 'PATCH',
    path: `/v1/team/roles/${roleId}`,
    body,
    schema: roleSchema,
  });
}

/** operationId deleteRole. Permission: team.manage. Only roles the business made, and only when nobody has them. */
export function deleteRole(client: ApiClient, roleId: string): Promise<void> {
  return client.request({
    method: 'DELETE',
    path: `/v1/team/roles/${roleId}`,
    schema: noContentSchema,
  });
}
