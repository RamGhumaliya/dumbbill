import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { Access, computeAccess } from './permissions.matrix';

/** Who the person is and what they may do, as loaded for one request. */
export interface LoadedAccess extends Access {
  userId: string;
  tenantId: string;
  roleId: string | null;
  roleName: string | null;
}

/**
 * Loads a person's access from the database.
 *
 * It runs on EVERY protected request, on purpose, instead of trusting what was true when the access token was made.
 * That is what makes changes immediate: when the owner removes a permission, switches a person off or moves them to
 * another role, the very next request they make is judged by the new rules, not 15 minutes later. It is one small
 * query (the person, their role and their branches), and it runs inside the tenant lock like everything else.
 */
@Injectable()
export class AccessService {
  constructor(private readonly tenantTx: TenantTx) {}

  /**
   * @throws DomainError UNAUTHENTICATED when the person no longer exists or has been switched off. Their sessions
   *         are also ended at that moment, so this is the second line of defence.
   */
  async load(userId: string): Promise<LoadedAccess> {
    return this.tenantTx.run((tx) => this.loadIn(tx, userId));
  }

  /** Same as `load`, inside a transaction the caller already has open (for example while building a login answer). */
  async loadIn(tx: TenantTransaction, userId: string): Promise<LoadedAccess> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { role: true, branches: { select: { branchId: true } } },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    const access = computeAccess({
      isOwner: user.isOwner,
      role: user.role,
      extraPermissions: user.extraPermissions,
      deniedPermissions: user.deniedPermissions,
      discountLimitBp: user.discountLimitBp,
      branchIds: user.branches.map((assignment) => assignment.branchId),
    });
    return {
      ...access,
      userId: user.id,
      tenantId: user.tenantId,
      roleId: user.roleId,
      roleName: user.role?.name ?? null,
    };
  }
}
