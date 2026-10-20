import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { Permission } from '../permissions/permission.decorators';
import { TenantTx } from '../tenancy/tenant-tx.service';
import { AuditChainService } from './audit-chain.service';
import { AuditEntryDto, AuditListDto, AuditVerifyDto, ListAuditQueryDto } from './dto/audit.dto';

/**
 * The audit log viewer (US-AUD-01): who did what, when, from where, with the state before and after. Read-only: the log
 * itself can never be edited. Needs `audit.read` (the owner has it; others only if the owner gave it).
 */
@ApiTags('Audit')
@ApiBearerAuth('staff-bearer')
@Controller('v1/audit')
export class AuditController {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly chain: AuditChainService,
  ) {}

  @Get()
  @Permission('audit.read')
  @ApiOperation({
    operationId: 'listAuditLog',
    summary: 'View the audit log',
    description:
      'Newest first, filtered by event name prefix, what it was done to, who did it, and a time range. Each entry shows the actor and the role they held, the address and device, and the state before and after when recorded. Entries are sealed into a tamper-evident chain whenever the log is viewed.\n\nPermission: audit.read',
  })
  @ApiOkResponse({ type: AuditListDto, description: 'A page of audit entries.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'limit', message: 'limit must not be greater than 100' }],
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async listAuditLog(@Query() query: ListAuditQueryDto): Promise<AuditListDto> {
    await this.chain.seal();
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    return this.tenantTx.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
        }),
        tx.auditLog.count({ where }),
      ]);
      const people = await tx.user.findMany({
        where: { id: { in: rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])) } },
        select: { id: true, fullName: true },
      });
      const names = new Map(people.map((person) => [person.id, person.fullName]));
      const asObject = (value: Prisma.JsonValue | null): Record<string, unknown> | null =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      const items = rows.map((row): AuditEntryDto => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        actorUserId: row.actorUserId,
        actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
        actorRole: row.actorRole,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        requestId: row.requestId,
        metadata: asObject(row.metadata),
        before: asObject(row.before),
        after: asObject(row.after),
      }));
      return { items, total, limit, offset };
    });
  }

  @Get('verify')
  @Permission('audit.read')
  @ApiOperation({
    operationId: 'verifyAuditLog',
    summary: 'Check the audit log has not been tampered with',
    description:
      'Seals any unsealed entries, then walks the whole chain and checks every seal against its entry. If an entry was changed or removed, says which seal is the first to fail. Changes nothing else.\n\nPermission: audit.read',
  })
  @ApiOkResponse({ type: AuditVerifyDto, description: 'ok is true when every seal matches.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async verifyAuditLog(): Promise<AuditVerifyDto> {
    await this.chain.seal();
    return this.chain.verify();
  }
}
