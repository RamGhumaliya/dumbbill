import { Injectable } from '@nestjs/common';
import { Branch, Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { LoadedAccess } from '../permissions/access.service';
import { BranchScope } from '../permissions/branch-scope';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { BranchDetailsDto } from './dto/business-requests.dto';
import { BranchDto, BranchListDto } from './dto/business-responses.dto';
import { panOf, validatePlace } from './place-rules';

/**
 * Branches (shops) of a business: create, edit, switch off and on.
 *
 * Rules:
 *  - The plan limits how many ACTIVE branches a business may have (`PLAN_LIMIT_REACHED`); switched-off branches are free.
 *  - The invoice prefix and the name are each unique inside the business.
 *  - A business always keeps at least one active branch (sales need somewhere to happen).
 *  - Switching a branch off keeps its history; nothing is deleted (invoices and stock refer to branches).
 *  - Row-level security only separates businesses, so reading is filtered by the person's branch scope here.
 *
 * Later (when invoices exist) the invoice prefix is locked once the branch has issued an invoice, because printed
 * invoice numbers must never change. Until then there are no invoices to protect.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  /** The branches the caller may use, plus how many the plan allows. */
  async list(actor: LoadedAccess): Promise<BranchListDto> {
    return this.tenantTx.run(async (tx) => {
      const scope = new BranchScope(actor);
      const [rows, states, limit] = await Promise.all([
        tx.branch.findMany({
          where: { id: scope.filter() },
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        }),
        tx.gstState.findMany(),
        this.limit(tx),
      ]);
      const names = new Map(states.map((state) => [state.code, state.name]));
      return { branches: rows.map((row) => toBranchDto(row, names)), limit };
    });
  }

  /** One branch. 404 when it is not in this business; 403 when the caller may not use it. */
  async get(actor: LoadedAccess, branchId: string): Promise<BranchDto> {
    return this.tenantTx.run(async (tx) => {
      const row = await this.load(tx, branchId);
      new BranchScope(actor).assert(row.id);
      return toBranchDto(row, await this.stateNames(tx));
    });
  }

  /** Add a branch (checks the plan limit). */
  async create(actor: LoadedAccess, dto: BranchDetailsDto, info: RequestInfo): Promise<BranchDto> {
    try {
      return await this.tenantTx.run(async (tx) => {
        await this.assertRoomForAnother(tx);
        await this.assertNameAndPrefixFree(tx, dto);
        const gstin = await this.checkedGstin(tx, dto);
        const row = await tx.branch.create({
          data: { tenantId: actor.tenantId, ...columnsOf(dto, gstin) },
        });
        await this.audit.write(
          tx,
          {
            action: 'branch.created',
            actorUserId: actor.userId,
            entity: 'branch',
            entityId: row.id,
            metadata: { name: row.name, invoicePrefix: row.invoicePrefix },
          },
          info,
        );
        return toBranchDto(row, await this.stateNames(tx));
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  /** Replace a branch's details. */
  async update(
    actor: LoadedAccess,
    branchId: string,
    dto: BranchDetailsDto,
    info: RequestInfo,
  ): Promise<BranchDto> {
    try {
      return await this.tenantTx.run(async (tx) => {
        const before = await this.load(tx, branchId);
        await this.assertNameAndPrefixFree(tx, dto, before.id);
        const gstin = await this.checkedGstin(tx, dto);
        const data = columnsOf(dto, gstin);
        const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
          (field) => before[field] !== data[field],
        );
        const row = await tx.branch.update({ where: { id: before.id }, data });
        if (changed.length > 0) {
          await this.audit.write(
            tx,
            {
              action: 'branch.updated',
              actorUserId: actor.userId,
              entity: 'branch',
              entityId: row.id,
              metadata: { changedFields: changed.join(',') },
            },
            info,
          );
        }
        return toBranchDto(row, await this.stateNames(tx));
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  /** Switch a branch off. The last active branch cannot be switched off. */
  async deactivate(actor: LoadedAccess, branchId: string, info: RequestInfo): Promise<BranchDto> {
    return this.tenantTx.run(async (tx) => {
      const before = await this.load(tx, branchId);
      if (before.isActive) {
        const active = await tx.branch.count({ where: { isActive: true } });
        if (active <= 1) {
          throw new DomainError(
            'BUSINESS_RULE_VIOLATION',
            'This is your only active branch. Add another branch before switching this one off.',
          );
        }
        await tx.branch.update({ where: { id: before.id }, data: { isActive: false } });
        await this.audit.write(
          tx,
          {
            action: 'branch.deactivated',
            actorUserId: actor.userId,
            entity: 'branch',
            entityId: before.id,
          },
          info,
        );
      }
      return toBranchDto(await this.load(tx, branchId), await this.stateNames(tx));
    });
  }

  /** Switch a branch back on (checks the plan limit again: seats are counted when branches are active). */
  async activate(actor: LoadedAccess, branchId: string, info: RequestInfo): Promise<BranchDto> {
    return this.tenantTx.run(async (tx) => {
      const before = await this.load(tx, branchId);
      if (!before.isActive) {
        await this.assertRoomForAnother(tx);
        await tx.branch.update({ where: { id: before.id }, data: { isActive: true } });
        await this.audit.write(
          tx,
          {
            action: 'branch.activated',
            actorUserId: actor.userId,
            entity: 'branch',
            entityId: before.id,
          },
          info,
        );
      }
      return toBranchDto(await this.load(tx, branchId), await this.stateNames(tx));
    });
  }

  // ---------------------------------------------------------------------------------------------

  /** One branch of this business, or 404 (another business's branch is invisible to us: row-level security). */
  private async load(tx: TenantTransaction, branchId: string): Promise<Branch> {
    const row = await tx.branch.findUnique({ where: { id: branchId } });
    if (!row) throw new DomainError('NOT_FOUND', 'This branch does not exist.');
    return row;
  }

  private async stateNames(tx: TenantTransaction): Promise<Map<string, string>> {
    const states = await tx.gstState.findMany();
    return new Map(states.map((state) => [state.code, state.name]));
  }

  /** How many active branches there are and how many the plan allows. */
  private async limit(tx: TenantTransaction): Promise<{ max: number; used: number }> {
    const [tenant, used] = await Promise.all([
      tx.tenant.findFirstOrThrow({ include: { plan: true } }),
      tx.branch.count({ where: { isActive: true } }),
    ]);
    return { max: tenant.plan?.maxBranches ?? 1, used };
  }

  /**
   * Say exactly which field clashes with another branch (name or invoice prefix). The database's unique indexes still
   * guard against two requests racing; this check gives the person a precise message in the normal case.
   */
  private async assertNameAndPrefixFree(
    tx: TenantTransaction,
    dto: BranchDetailsDto,
    exceptId?: string,
  ): Promise<void> {
    const others = { id: exceptId ? { not: exceptId } : undefined };
    if (await tx.branch.findFirst({ where: { ...others, invoicePrefix: dto.invoicePrefix } })) {
      throw duplicate('invoicePrefix');
    }
    if (await tx.branch.findFirst({ where: { ...others, name: dto.name } })) {
      throw duplicate('name');
    }
  }

  /** Plan-limit guard: refuse when every branch the plan allows is already active. */
  private async assertRoomForAnother(tx: TenantTransaction): Promise<void> {
    const { max, used } = await this.limit(tx);
    if (used >= max) {
      throw new DomainError(
        'PLAN_LIMIT_REACHED',
        `Your plan allows ${max} ${max === 1 ? 'branch' : 'branches'} and all are in use. Switch a branch off or upgrade the plan.`,
      );
    }
  }

  /** Validate the branch's state and GSTIN; its PAN must match the business GSTIN's PAN when the business has one. */
  private async checkedGstin(tx: TenantTransaction, dto: BranchDetailsDto): Promise<string | null> {
    const tenant = await tx.tenant.findFirstOrThrow({ select: { gstin: true } });
    const { gstin } = await validatePlace(tx, dto, panOf(tenant.gstin));
    return gstin;
  }
}

/** The database columns a branch form fills. Optional text becomes null. */
function columnsOf(dto: BranchDetailsDto, gstin: string | null) {
  return {
    name: dto.name,
    invoicePrefix: dto.invoicePrefix,
    printerWidthMm: dto.printerWidthMm,
    stateCode: dto.stateCode,
    gstin,
    addressLine: dto.addressLine ?? null,
    city: dto.city ?? null,
    pincode: dto.pincode ?? null,
    phone: dto.phone ?? null,
  };
}

/** The error for a name or invoice prefix another branch already has. */
function duplicate(field: 'name' | 'invoicePrefix'): DomainError {
  const message =
    field === 'invoicePrefix'
      ? 'Another branch already uses this invoice prefix.'
      : 'Another branch already has this name.';
  return new DomainError('CONFLICT', message, [{ field, message }]);
}

/**
 * Two requests can pass the checks above at the same moment; the database's unique indexes then stop the second one.
 * We cannot rely on which column Prisma names in that rare case, so the message stays general.
 */
function translateDuplicate(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new DomainError('CONFLICT', 'Another branch already has this name or invoice prefix.');
  }
  return error;
}

/** Describe a branch for the API. */
function toBranchDto(row: Branch, stateNames: Map<string, string>): BranchDto {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    invoicePrefix: row.invoicePrefix,
    printerWidthMm: row.printerWidthMm,
    stateCode: row.stateCode,
    stateName: row.stateCode ? (stateNames.get(row.stateCode) ?? null) : null,
    gstin: row.gstin,
    addressLine: row.addressLine,
    city: row.city,
    pincode: row.pincode,
    phone: row.phone,
  };
}
