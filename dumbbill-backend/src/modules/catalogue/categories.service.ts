import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { LoadedAccess } from '../permissions/access.service';
import { TenantTx } from '../tenancy/tenant-tx.service';
import { isAllowedGstRate } from './domain/gst-rates';
import { CreateCategoryDto } from './dto/catalogue-requests.dto';
import { CategoryDto } from './dto/catalogue-responses.dto';
import { toCategoryDto } from './products.service';

/**
 * Product categories of a business. New businesses start with a copy of the category templates; the owner adds more
 * here. A category's HSN and GST rate are only SUGGESTIONS that pre-fill the product form (the CA decides the real
 * values per product), so they are checked for shape but never forced onto products.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  /**
   * Add a category.
   * @throws DomainError VALIDATION_FAILED for a GST rate that is not in the allowed list; CONFLICT when the name exists.
   */
  async create(
    actor: LoadedAccess,
    dto: CreateCategoryDto,
    info: RequestInfo,
  ): Promise<CategoryDto> {
    if (
      dto.defaultGstRateBp !== undefined &&
      dto.defaultGstRateBp !== null &&
      !isAllowedGstRate(dto.defaultGstRateBp)
    ) {
      throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', [
        { field: 'defaultGstRateBp', message: 'Choose a GST rate from the list.' },
      ]);
    }
    try {
      return await this.tenantTx.run(async (tx) => {
        const clash = await tx.productCategory.findFirst({
          where: { name: { equals: dto.name, mode: 'insensitive' } },
        });
        if (clash) throw nameTaken();
        const row = await tx.productCategory.create({
          data: {
            tenantId: actor.tenantId,
            name: dto.name,
            defaultHsn: dto.defaultHsn ?? null,
            defaultGstRateBp: dto.defaultGstRateBp ?? null,
          },
        });
        await this.audit.write(
          tx,
          {
            action: 'category.created',
            actorUserId: actor.userId,
            entity: 'product_category',
            entityId: row.id,
            metadata: { name: row.name },
          },
          info,
        );
        return toCategoryDto(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw nameTaken();
      throw error;
    }
  }
}

function nameTaken(): DomainError {
  return new DomainError('CONFLICT', 'A category with this name already exists.', [
    { field: 'name', message: 'A category with this name already exists.' },
  ]);
}
