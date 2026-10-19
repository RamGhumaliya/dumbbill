import { Injectable, StreamableFile } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { LoadedAccess } from '../permissions/access.service';
import { buildStorageKey } from '../storage/storage-key';
import { FileStorage, StorageValidationError } from '../storage/storage.types';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { BusinessProfileDto, GstStateListDto, OnboardingDto } from './dto/business-responses.dto';
import { UpdateBusinessDto } from './dto/business-requests.dto';
import { panOf, validatePlace } from './place-rules';

/** Logo file types we accept, mapped to the extension used in the storage key. */
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * The business profile (name, GSTIN, state, address) and the first-steps checklist.
 *
 * The GSTIN and state saved here drive tax: the business state is compared with the customer's state to choose
 * CGST+SGST (same state) or IGST (different state). That is why the state is required and why a GSTIN must agree with it.
 */
@Injectable()
export class BusinessService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
  ) {}

  /** The signed-in person's business. */
  async get(): Promise<BusinessProfileDto> {
    return this.tenantTx.run(async (tx) => {
      const tenant = await tx.tenant.findFirstOrThrow();
      return this.describe(tx, tenant);
    });
  }

  /** The list of GST states for the state picker. */
  async states(): Promise<GstStateListDto> {
    const states = await this.tenantTx.run((tx) =>
      tx.gstState.findMany({ orderBy: { name: 'asc' } }),
    );
    return {
      states: states.map(({ code, name, isUnionTerritory }) => ({ code, name, isUnionTerritory })),
    };
  }

  /**
   * Replace the profile. A GSTIN that is given is checked (shape, check character, state, and the branches' PAN must still
   * match), and the change is audited with the NAMES of the fields that changed (not their values).
   *
   * @throws DomainError VALIDATION_FAILED for a bad state or GSTIN; BUSINESS_RULE_VIOLATION when the new GSTIN's PAN
   *   would disagree with a branch GSTIN already saved.
   */
  async update(
    actor: LoadedAccess,
    dto: UpdateBusinessDto,
    info: RequestInfo,
  ): Promise<BusinessProfileDto> {
    return this.tenantTx.run(async (tx) => {
      const before = await tx.tenant.findFirstOrThrow();
      const { gstin } = await validatePlace(tx, dto);

      // A new business PAN must still match every branch GSTIN already saved, or the branches would contradict it.
      const newPan = panOf(gstin);
      if (newPan) {
        const branches = await tx.branch.findMany({
          where: { gstin: { not: null } },
          select: { gstin: true },
        });
        if (branches.some((branch) => panOf(branch.gstin) !== newPan)) {
          throw new DomainError(
            'BUSINESS_RULE_VIOLATION',
            'A branch already has a GSTIN with a different PAN. Fix the branch first, or use the same PAN.',
          );
        }
      }

      const next = {
        name: dto.name,
        gstin,
        stateCode: dto.stateCode,
        addressLine: dto.addressLine ?? null,
        city: dto.city ?? null,
        pincode: dto.pincode ?? null,
        phone: dto.phone ?? null,
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
        (field) => before[field] !== next[field],
      );
      const updated = await tx.tenant.update({ where: { id: before.id }, data: next });
      if (changed.length > 0) {
        await this.audit.write(
          tx,
          {
            action: 'business.profile_updated',
            actorUserId: actor.userId,
            entity: 'tenant',
            entityId: before.id,
            metadata: { changedFields: changed.join(',') },
          },
          info,
        );
      }
      return this.describe(tx, updated);
    });
  }

  /**
   * Save the business logo (replaces the old one). Only PNG, JPEG and WebP are accepted, and the storage layer checks the
   * file's first bytes really are that type, so a renamed script is refused. The file name is random (see storage-key.ts).
   *
   * @throws StorageValidationError (mapped to 415/422/413) for a wrong type, an empty file or a too-large file.
   */
  async setLogo(
    actor: LoadedAccess,
    file: { buffer: Buffer; mimetype: string },
    info: RequestInfo,
  ): Promise<BusinessProfileDto> {
    const extension = LOGO_TYPES[file.mimetype];
    if (!extension) {
      throw new StorageValidationError(
        'TYPE_NOT_ALLOWED',
        'A logo must be a PNG, JPEG or WebP image.',
      );
    }
    const key = buildStorageKey({ tenantId: actor.tenantId, category: 'logos', extension });
    await this.storage.put({ key, data: file.buffer, contentType: file.mimetype });
    const oldKey = await this.tenantTx.run(async (tx) => {
      const before = await tx.tenant.findFirstOrThrow({ select: { id: true, logoKey: true } });
      await tx.tenant.update({ where: { id: before.id }, data: { logoKey: key } });
      await this.audit.write(
        tx,
        {
          action: 'business.logo_changed',
          actorUserId: actor.userId,
          entity: 'tenant',
          entityId: before.id,
        },
        info,
      );
      return before.logoKey;
    });
    // Delete the old file only after the new one is saved and recorded, so a failure never leaves the business with no logo.
    if (oldKey) await this.storage.delete(oldKey);
    return this.get();
  }

  /** Remove the logo. Doing it twice is fine. */
  async removeLogo(actor: LoadedAccess, info: RequestInfo): Promise<void> {
    const oldKey = await this.tenantTx.run(async (tx) => {
      const before = await tx.tenant.findFirstOrThrow({ select: { id: true, logoKey: true } });
      if (!before.logoKey) return null;
      await tx.tenant.update({ where: { id: before.id }, data: { logoKey: null } });
      await this.audit.write(
        tx,
        {
          action: 'business.logo_removed',
          actorUserId: actor.userId,
          entity: 'tenant',
          entityId: before.id,
        },
        info,
      );
      return before.logoKey;
    });
    if (oldKey) await this.storage.delete(oldKey);
  }

  /**
   * The logo image, ready to send. The key comes from this business's own row (row-level security), never from the
   * request, so nobody can ask for another business's file.
   *
   * @throws DomainError NOT_FOUND when there is no logo.
   */
  async openLogo(): Promise<{ file: StreamableFile; contentType: string; size: number }> {
    const tenant = await this.tenantTx.run((tx) =>
      tx.tenant.findFirstOrThrow({ select: { logoKey: true } }),
    );
    if (!tenant.logoKey) throw new DomainError('NOT_FOUND', 'This business has no logo.');
    const opened = await this.storage.get(tenant.logoKey);
    return {
      file: new StreamableFile(opened.stream),
      contentType: opened.contentType,
      size: opened.size,
    };
  }

  /**
   * The first-steps checklist. Each step is "done" when real data proves it: a profile with state and address, a
   * branch with its address, a second person on the team.
   */
  async onboarding(): Promise<OnboardingDto> {
    return this.tenantTx.run(async (tx) => {
      const [tenant, detailedBranches, people] = await Promise.all([
        tx.tenant.findFirstOrThrow(),
        tx.branch.count({
          where: { isActive: true, stateCode: { not: null }, addressLine: { not: null } },
        }),
        tx.user.count({ where: { status: { not: 'DISABLED' } } }),
      ]);
      return {
        steps: [
          {
            key: 'PROFILE',
            done: Boolean(tenant.stateCode && tenant.addressLine && tenant.city && tenant.pincode),
          },
          { key: 'BRANCH', done: detailedBranches > 0 },
          { key: 'TEAM', done: people > 1 },
        ],
        gstinMissing: !tenant.gstin,
      };
    });
  }

  private async describe(tx: TenantTransaction, tenant: Tenant): Promise<BusinessProfileDto> {
    const state = tenant.stateCode
      ? await tx.gstState.findUnique({ where: { code: tenant.stateCode } })
      : null;
    return {
      name: tenant.name,
      gstin: tenant.gstin,
      stateCode: tenant.stateCode,
      stateName: state?.name ?? null,
      addressLine: tenant.addressLine,
      city: tenant.city,
      pincode: tenant.pincode,
      phone: tenant.phone,
      hasLogo: tenant.logoKey !== null,
    };
  }
}
