import { Injectable } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';
import { DomainError, FieldError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { checkGstin } from '../business/domain/gstin';
import { LoadedAccess } from '../permissions/access.service';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { ListSuppliersQueryDto, SupplierDetailsDto } from './dto/purchasing-requests.dto';
import { SupplierDto, SupplierListDto } from './dto/purchasing-responses.dto';

/**
 * Suppliers: the businesses a shop buys from.
 *
 * Rules: a name is unique inside the business (ignoring case); a GSTIN, when given, must be well formed with a correct check
 * character (the same rule as the business's own GSTIN); suppliers are switched off, never deleted, because purchases and
 * debit notes refer to them. What the shop owes a supplier (their balance) is worked out from their bills and debit notes
 * every time, never stored, so it cannot drift from the documents.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListSuppliersQueryDto): Promise<SupplierListDto> {
    const status = query.status ?? 'active';
    return this.tenantTx.run(async (tx) => {
      const rows = await tx.supplier.findMany({
        where: {
          ...(status === 'all' ? {} : { isActive: status === 'active' }),
          ...(query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { gstin: { contains: query.q, mode: 'insensitive' } },
                  { phone: { contains: query.q } },
                ],
              }
            : {}),
        },
        orderBy: { name: 'asc' },
      });
      const balances = await this.balances(
        tx,
        rows.map((row) => row.id),
      );
      return { suppliers: rows.map((row) => toDto(row, balances.get(row.id) ?? 0)) };
    });
  }

  async get(supplierId: string): Promise<SupplierDto> {
    return this.tenantTx.run(async (tx) => {
      const row = await this.load(tx, supplierId);
      return toDto(row, (await this.balances(tx, [row.id])).get(row.id) ?? 0);
    });
  }

  async create(
    actor: LoadedAccess,
    dto: SupplierDetailsDto,
    info: RequestInfo,
  ): Promise<SupplierDto> {
    try {
      return await this.tenantTx.run(async (tx) => {
        const gstin = checkedGstin(dto.gstin);
        await this.assertNameFree(tx, dto.name);
        const row = await tx.supplier.create({
          data: { tenantId: actor.tenantId, ...columnsOf(dto, gstin) },
        });
        await this.audit.write(
          tx,
          {
            action: 'supplier.created',
            actorUserId: actor.userId,
            actorRole: actor.roleName,
            entity: 'supplier',
            entityId: row.id,
            metadata: { name: row.name },
          },
          info,
        );
        return toDto(row, 0);
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  async update(
    actor: LoadedAccess,
    supplierId: string,
    dto: SupplierDetailsDto,
    info: RequestInfo,
  ): Promise<SupplierDto> {
    try {
      return await this.tenantTx.run(async (tx) => {
        const before = await this.load(tx, supplierId);
        const gstin = checkedGstin(dto.gstin);
        await this.assertNameFree(tx, dto.name, supplierId);
        const data = columnsOf(dto, gstin);
        const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
          (field) => before[field] !== data[field],
        );
        const row = await tx.supplier.update({ where: { id: supplierId }, data });
        if (changed.length > 0) {
          await this.audit.write(
            tx,
            {
              action: 'supplier.updated',
              actorUserId: actor.userId,
              actorRole: actor.roleName,
              entity: 'supplier',
              entityId: supplierId,
              metadata: { changedFields: changed.join(',') },
            },
            info,
          );
        }
        return toDto(row, (await this.balances(tx, [row.id])).get(row.id) ?? 0);
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  /** Switch a supplier off or on (safe to repeat). Their history stays. */
  async setActive(
    actor: LoadedAccess,
    supplierId: string,
    active: boolean,
    info: RequestInfo,
  ): Promise<SupplierDto> {
    return this.tenantTx.run(async (tx) => {
      const before = await this.load(tx, supplierId);
      const row =
        before.isActive === active
          ? before
          : await tx.supplier.update({ where: { id: supplierId }, data: { isActive: active } });
      if (before.isActive !== active) {
        await this.audit.write(
          tx,
          {
            action: active ? 'supplier.activated' : 'supplier.deactivated',
            actorUserId: actor.userId,
            actorRole: actor.roleName,
            entity: 'supplier',
            entityId: supplierId,
          },
          info,
        );
      }
      return toDto(row, (await this.balances(tx, [row.id])).get(row.id) ?? 0);
    });
  }

  /** One supplier of this business, or 404 (another business's supplier is invisible: row-level security). */
  async load(tx: TenantTransaction, supplierId: string): Promise<Supplier> {
    const row = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!row) throw new DomainError('NOT_FOUND', 'This supplier does not exist.');
    return row;
  }

  /** Name the clash when another supplier already has this name (ignoring case). */
  private async assertNameFree(
    tx: TenantTransaction,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await tx.supplier.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) throw nameTaken();
  }

  /** What the shop owes each supplier: their bills minus the credit on their debit notes, in paise. */
  private async balances(
    tx: TenantTransaction,
    supplierIds: string[],
  ): Promise<Map<string, number>> {
    const [bought, returned] = await Promise.all([
      tx.purchase.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: supplierIds } },
        _sum: { totalPaise: true },
      }),
      tx.supplierReturn.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: supplierIds } },
        _sum: { creditTotalPaise: true },
      }),
    ]);
    const balances = new Map<string, number>();
    for (const row of bought) balances.set(row.supplierId, row._sum.totalPaise ?? 0);
    for (const row of returned) {
      balances.set(
        row.supplierId,
        (balances.get(row.supplierId) ?? 0) - (row._sum.creditTotalPaise ?? 0),
      );
    }
    return balances;
  }
}

/** The GSTIN, checked (shape and check character), or null when none was given. */
function checkedGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const result = checkGstin(gstin);
  if (!result.valid) {
    const errors: FieldError[] = [
      {
        field: 'gstin',
        message:
          result.problem === 'SHAPE'
            ? 'A GSTIN has 15 characters, like 27AAPFU0939F1ZV.'
            : 'This GSTIN has a typing mistake: its last character does not match the others.',
      },
    ];
    throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', errors);
  }
  return result.gstin;
}

function columnsOf(dto: SupplierDetailsDto, gstin: string | null) {
  return {
    name: dto.name,
    gstin,
    phone: dto.phone ?? null,
    email: dto.email ?? null,
    addressLine: dto.addressLine ?? null,
    city: dto.city ?? null,
    notes: dto.notes ?? null,
  };
}

function nameTaken(): DomainError {
  return new DomainError('CONFLICT', 'A supplier with this name already exists.', [
    { field: 'name', message: 'A supplier with this name already exists.' },
  ]);
}

/** Two requests can pass the name check at the same moment; the unique index then stops the second. */
function translateDuplicate(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    return nameTaken();
  return error;
}

function toDto(row: Supplier, balancePaise: number): SupplierDto {
  return {
    id: row.id,
    name: row.name,
    gstin: row.gstin,
    phone: row.phone,
    email: row.email,
    addressLine: row.addressLine,
    city: row.city,
    notes: row.notes,
    isActive: row.isActive,
    balancePaise,
  };
}
