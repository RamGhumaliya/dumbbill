import { TenantTransaction } from '../tenancy/tenant-tx.service';
import { ROLE_PRESETS, SystemRoleKey } from './permissions.matrix';

/** Name of the first branch every business starts with. Renamed in the business settings (P1-3). */
export const DEFAULT_BRANCH_NAME = 'Main branch';

/**
 * Give a brand-new business what it needs to have people and branches: the three built-in roles (Owner, Admin,
 * Cashier, from ROLE_PRESETS) and one branch. Called by sign-up inside the same transaction that creates the business,
 * so a business never exists without them.
 *
 * (Businesses that existed before roles were introduced got the same through the backfill in the
 * `roles_and_team` migration.)
 *
 * @returns the id of each built-in role, and of the first branch.
 */
export async function createDefaultRolesAndBranch(
  tx: TenantTransaction,
  tenantId: string,
): Promise<{ roleIds: Record<SystemRoleKey, string>; branchId: string }> {
  const roleIds = {} as Record<SystemRoleKey, string>;
  for (const key of Object.keys(ROLE_PRESETS) as SystemRoleKey[]) {
    const preset = ROLE_PRESETS[key];
    const role = await tx.role.create({
      data: {
        tenantId,
        name: preset.name,
        description: preset.description,
        systemKey: key,
        permissions: [...preset.permissions],
        discountLimitBp: preset.discountLimitBp,
        allBranches: preset.allBranches,
      },
    });
    roleIds[key] = role.id;
  }
  const branch = await tx.branch.create({ data: { tenantId, name: DEFAULT_BRANCH_NAME } });
  return { roleIds, branchId: branch.id };
}
