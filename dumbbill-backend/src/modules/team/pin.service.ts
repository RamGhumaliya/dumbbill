import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { PasswordHasher } from '../auth/password/password-hasher.service';
import { RateLimiter } from '../auth/rate-limit/rate-limiter.service';
import { LoadedAccess } from '../permissions/access.service';
import { computeAccess } from '../permissions/permissions.matrix';
import { TenantTx } from '../tenancy/tenant-tx.service';
import { ApproverDto } from './dto/team-responses.dto';

/**
 * The 6-digit approval PIN.
 *
 * WHAT IT IS FOR. At the till, a cashier may only give discounts up to their limit. For more, a manager walks over and
 * types THEIR OWN PIN: quick, no logging in and out, and the system records who approved. (Security doc, section 2.)
 *
 * HOW IT IS PROTECTED. A PIN is only 1,000,000 possibilities, so it is weak by nature. Three things make that safe:
 *  1. It is hashed with the same peppered Argon2id as passwords. The pepper is a server secret, so a stolen database
 *     alone cannot be used to guess PINs offline. (If the pepper AND the database leaked, PINs could be guessed in
 *     seconds: accepted, and another reason to keep the pepper out of the database.)
 *  2. Guessing online is slowed to a crawl: 5 wrong tries lock that approver's PIN for the person trying (1 minute,
 *     doubling), plus an overall ceiling per approver and per address.
 *  3. Obvious PINs (123456, 000000, repeated digits) are refused when set.
 * The lock is per (approver, person trying), so one cashier guessing cannot lock the manager out for everyone else.
 *
 * NOTHING IS REVEALED. Checking a PIN answers the same `INVALID_PIN` whether the PIN is wrong, the person has no PIN,
 * is switched off, does not exist, or simply is not allowed to approve. Otherwise this would be a way to find out who
 * has a PIN or who may approve.
 */
@Injectable()
export class PinService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
  ) {}

  /** Set or change my own PIN. Needs my password. */
  async setPin(
    userId: string,
    currentPassword: string,
    pin: string,
    info: RequestInfo,
  ): Promise<void> {
    await this.limiter.hit('pin:set', userId, 5, 15 * 60);
    await this.assertPassword(userId, currentPassword);
    const weakness = pinWeakness(pin);
    if (weakness)
      throw new DomainError('VALIDATION_FAILED', 'This PIN is too easy to guess.', [
        { field: 'pin', message: weakness },
      ]);

    const pinHash = await this.hasher.hash(pin);
    await this.tenantTx.run(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { pinHash, pinSetAt: new Date() } });
      await this.audit.write(
        tx,
        { action: 'auth.pin_set', actorUserId: userId, entity: 'user', entityId: userId },
        info,
      );
    });
  }

  /** Remove my own PIN. Needs my password. */
  async clearPin(userId: string, currentPassword: string, info: RequestInfo): Promise<void> {
    await this.limiter.hit('pin:set', userId, 5, 15 * 60);
    await this.assertPassword(userId, currentPassword);
    await this.tenantTx.run(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { pinHash: null, pinSetAt: null } });
      await this.audit.write(
        tx,
        { action: 'auth.pin_cleared', actorUserId: userId, entity: 'user', entityId: userId },
        info,
      );
    });
  }

  /** People who can approve discounts and have a PIN, for the cashier to pick from. */
  async listApprovers(): Promise<ApproverDto[]> {
    const users = await this.tenantTx.run((tx) =>
      tx.user.findMany({
        where: { status: 'ACTIVE', pinHash: { not: null } },
        include: { role: true, branches: { select: { branchId: true } } },
        orderBy: { fullName: 'asc' },
      }),
    );
    return users
      .filter((user) =>
        computeAccess({
          isOwner: user.isOwner,
          role: user.role,
          extraPermissions: user.extraPermissions,
          deniedPermissions: user.deniedPermissions,
          discountLimitBp: user.discountLimitBp,
          branchIds: user.branches.map((b) => b.branchId),
        }).permissions.has('discount.approve'),
      )
      .map((user) => ({ id: user.id, fullName: user.fullName }));
  }

  /**
   * Check an approver's PIN on behalf of the signed-in person (the cashier).
   * @throws DomainError INVALID_PIN for every reason a PIN cannot be accepted (see the class comment)
   * @throws DomainError RATE_LIMITED when too many wrong tries
   */
  async verifyApproverPin(
    actor: LoadedAccess,
    approverUserId: string,
    pin: string,
    info: RequestInfo,
  ): Promise<ApproverDto> {
    await this.limiter.hit('pin:ip', info.ip ?? 'unknown', 30, 60);
    await this.limiter.hit('pin:approver', approverUserId, 30, 60 * 60);
    const lockKey = `pin:${approverUserId}:${actor.userId}`;
    await this.limiter.assertNotLocked(lockKey);

    const approver = await this.tenantTx.run((tx) =>
      tx.user.findUnique({
        where: { id: approverUserId },
        include: { role: true, branches: { select: { branchId: true } } },
      }),
    );

    const check =
      approver && approver.status === 'ACTIVE' && approver.pinHash
        ? await this.hasher.verify(approver.pinHash, pin)
        : null;
    if (!check) await this.hasher.burnTime(pin); // same time spent whether or not there was a PIN to check
    const mayApprove =
      approver !== null &&
      computeAccess({
        isOwner: approver.isOwner,
        role: approver.role,
        extraPermissions: approver.extraPermissions,
        deniedPermissions: approver.deniedPermissions,
        discountLimitBp: approver.discountLimitBp,
        branchIds: approver.branches.map((b) => b.branchId),
      }).permissions.has('discount.approve');

    if (!approver || !check?.valid || !mayApprove) {
      await this.limiter.recordLoginFailure(lockKey);
      await this.tenantTx.run((tx) =>
        this.audit.write(
          tx,
          {
            action: 'approval.pin_rejected',
            actorUserId: actor.userId,
            entity: 'user',
            entityId: approverUserId,
          },
          info,
        ),
      );
      throw new DomainError('INVALID_PIN', 'That PIN is not valid.');
    }

    await this.limiter.clearLoginFailures(lockKey);
    await this.tenantTx.run((tx) =>
      this.audit.write(
        tx,
        {
          action: 'approval.pin_verified',
          actorUserId: actor.userId,
          entity: 'user',
          entityId: approver.id,
          metadata: { approver: approver.fullName },
        },
        info,
      ),
    );
    return { id: approver.id, fullName: approver.fullName };
  }

  private async assertPassword(userId: string, password: string): Promise<void> {
    const user = await this.tenantTx.run((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    );
    const ok = user.passwordHash
      ? (await this.hasher.verify(user.passwordHash, password)).valid
      : false;
    if (!ok) throw new DomainError('INVALID_CREDENTIALS', 'The password is not correct.');
  }
}

/**
 * Why a PIN is too easy to guess, or null if it is fine. Refuses all-the-same digits, straight runs up or down
 * (123456, 654321) and a few famous ones. The list is short on purpose: the real defence is the lockout.
 */
export function pinWeakness(pin: string): string | null {
  if (/^(\d)\1{5}$/.test(pin)) return 'Do not repeat the same digit.';
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((digit, i) => digit - digits[i]!));
  if (steps.size === 1 && (steps.has(1) || steps.has(-1)))
    return 'Do not use a straight run such as 123456.';
  if (['121212', '112233', '123123', '000123', '101010', '696969', '142536'].includes(pin))
    return 'That PIN is too common.';
  return null;
}
