import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { LoadedAccess } from '../permissions/access.service';
import { PermissionKey, permissionsActorCannotGrant } from '../permissions/permissions.matrix';
import { TenantTx } from '../tenancy/tenant-tx.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/team-requests.dto';
import { RoleDto } from './dto/team-responses.dto';

/** The row shape returned by the role queries: the role plus how many people hold it. */
type RoleWithCount = Role & { _count: { users: number } };

/** What an actor may NOT hand out, as one readable sentence for an error message. */
function describeMissing(missing: string[]): string {
  return `You can only grant permissions you hold yourself. Missing: ${missing.join(', ')}.`;
}

/**
 * Roles: the named bundles of permissions ("Cashier") that a business hands out.
 *
 * Rules, all enforced here so no screen or client can bypass them:
 *  - The OWNER role is locked. The owner always holds every permission, so editing or deleting roles can never
 *    lock them out of their own business.
 *  - The built-in Admin and Cashier roles can have their permissions, discount limit and branch rule edited (every
 *    business works differently), but they keep their names and cannot be deleted. Businesses may add their own roles.
 *  - NO ESCALATION. A person who manages the team can only hand out what they hold: not a permission they lack, not a
 *    bigger discount limit than their own, not "all branches" when they are limited to some. The owner is exempt.
 *    Without this rule a team manager could simply make a role more powerful than themselves and put themselves in it.
 *  - Every change is written to the audit log, with what was added and removed.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  /** All roles of the business, built-in ones first, with how many people hold each. */
  async list(): Promise<RoleDto[]> {
    const roles = await this.tenantTx.run((tx) =>
      tx.role.findMany({
        include: { _count: { select: { users: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return roles.map(toRoleDto);
  }

  /** Make a new role for this business. */
  async create(actor: LoadedAccess, dto: CreateRoleDto, info: RequestInfo): Promise<RoleDto> {
    const discountLimitBp = dto.discountLimitBp ?? 0;
    const allBranches = dto.allBranches ?? false;
    this.assertCanGrant(actor, dto.permissions, discountLimitBp, allBranches);

    try {
      const role = await this.tenantTx.run(async (tx) => {
        const created = await tx.role.create({
          data: {
            tenantId: actor.tenantId,
            name: dto.name.trim(),
            description: dto.description?.trim() ?? '',
            permissions: dto.permissions,
            discountLimitBp,
            allBranches,
          },
          include: { _count: { select: { users: true } } },
        });
        await this.audit.write(
          tx,
          {
            action: 'team.role_created',
            actorUserId: actor.userId,
            entity: 'role',
            entityId: created.id,
            metadata: { name: created.name, permissions: dto.permissions.join(',') },
          },
          info,
        );
        return created;
      });
      return toRoleDto(role);
    } catch (error) {
      throw this.translateDuplicate(error);
    }
  }

  /** Change a role. The change applies to everyone in the role from their very next request. */
  async update(
    actor: LoadedAccess,
    roleId: string,
    dto: UpdateRoleDto,
    info: RequestInfo,
  ): Promise<RoleDto> {
    try {
      const role = await this.tenantTx.run(async (tx) => {
        const existing = await tx.role.findUnique({ where: { id: roleId } });
        if (!existing) throw new DomainError('NOT_FOUND', 'No role with this id.');
        if (existing.systemKey === 'OWNER') {
          throw new DomainError(
            'FORBIDDEN',
            'The Owner role always has every permission and cannot be changed.',
          );
        }
        if (
          dto.name !== undefined &&
          existing.systemKey !== null &&
          dto.name.trim() !== existing.name
        ) {
          throw new DomainError(
            'BUSINESS_RULE_VIOLATION',
            'The built-in roles keep their names. Create a new role to use another name.',
          );
        }

        const before = new Set(existing.permissions);
        const after = dto.permissions ?? existing.permissions;
        const added = after.filter((key) => !before.has(key));
        const removed = existing.permissions.filter((key) => !after.includes(key));
        const newLimit = dto.discountLimitBp ?? existing.discountLimitBp;
        const newAll = dto.allBranches ?? existing.allBranches;

        // Only what is being ADDED needs the actor's authority. Taking power away is always allowed.
        this.assertCanGrant(
          actor,
          added as PermissionKey[],
          newLimit > existing.discountLimitBp ? newLimit : 0,
          newAll && !existing.allBranches,
        );

        const updated = await tx.role.update({
          where: { id: roleId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
            ...(dto.permissions !== undefined ? { permissions: dto.permissions } : {}),
            ...(dto.discountLimitBp !== undefined ? { discountLimitBp: dto.discountLimitBp } : {}),
            ...(dto.allBranches !== undefined ? { allBranches: dto.allBranches } : {}),
          },
          include: { _count: { select: { users: true } } },
        });
        await this.audit.write(
          tx,
          {
            action: 'team.role_updated',
            actorUserId: actor.userId,
            entity: 'role',
            entityId: roleId,
            metadata: {
              name: updated.name,
              added: added.join(','),
              removed: removed.join(','),
              discountLimitBp: updated.discountLimitBp,
              allBranches: updated.allBranches,
            },
          },
          info,
        );
        return updated;
      });
      return toRoleDto(role);
    } catch (error) {
      throw this.translateDuplicate(error);
    }
  }

  /** Delete a role the business made itself, when nobody has it any more. */
  async remove(actor: LoadedAccess, roleId: string, info: RequestInfo): Promise<void> {
    await this.tenantTx.run(async (tx) => {
      const existing = await tx.role.findUnique({
        where: { id: roleId },
        include: { _count: { select: { users: true } } },
      });
      if (!existing) throw new DomainError('NOT_FOUND', 'No role with this id.');
      if (existing.systemKey !== null) {
        throw new DomainError('BUSINESS_RULE_VIOLATION', 'The built-in roles cannot be deleted.');
      }
      if (existing._count.users > 0) {
        throw new DomainError(
          'CONFLICT',
          `${existing._count.users} people still have this role. Move them to another role first.`,
        );
      }
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.write(
        tx,
        {
          action: 'team.role_deleted',
          actorUserId: actor.userId,
          entity: 'role',
          entityId: roleId,
          metadata: { name: existing.name },
        },
        info,
      );
    });
  }

  /**
   * The no-escalation rule. `limitToGrant` is the discount limit being handed out (0 = none); `grantsAllBranches` is
   * true when the change gives "all branches" to a role that did not have it.
   * @throws DomainError FORBIDDEN naming what the actor may not grant.
   */
  private assertCanGrant(
    actor: LoadedAccess,
    permissions: readonly PermissionKey[],
    limitToGrant: number,
    grantsAllBranches: boolean,
  ): void {
    const missing = permissionsActorCannotGrant(actor, permissions);
    if (missing.length > 0) throw new DomainError('FORBIDDEN', describeMissing(missing));
    if (!actor.isOwner && limitToGrant > actor.discountLimitBp) {
      throw new DomainError('FORBIDDEN', 'You cannot give a bigger discount limit than your own.');
    }
    if (!actor.isOwner && grantsAllBranches && actor.branchScope !== 'ALL') {
      throw new DomainError(
        'FORBIDDEN',
        'You cannot give access to every branch because you do not have it yourself.',
      );
    }
  }

  /** A second role with the same name is a normal mistake: say so plainly instead of a database error. */
  private translateDuplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new DomainError('CONFLICT', 'A role with this name already exists.');
    }
    return error;
  }
}

/** Describe a role for the API. */
export function toRoleDto(role: RoleWithCount): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    systemKey: role.systemKey,
    locked: role.systemKey === 'OWNER',
    permissions: role.permissions,
    discountLimitBp: role.discountLimitBp,
    allBranches: role.allBranches,
    memberCount: role._count.users,
  };
}
