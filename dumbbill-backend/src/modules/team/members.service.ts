import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User, UserBranch } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../audit/audit.service';
import { AuthTokenService } from '../auth/auth-token.service';
import { parseToken } from '../auth/domain/opaque-token';
import { hashSecret } from '../auth/domain/opaque-token';
import { PasswordHasher } from '../auth/password/password-hasher.service';
import { PasswordRules } from '../auth/password/password-rules.service';
import { RateLimiter } from '../auth/rate-limit/rate-limiter.service';
import { SessionService } from '../auth/session/session.service';
import { invitationEmail } from '../mail/auth-emails';
import { Mailer } from '../mail/mailer';
import { LoadedAccess } from '../permissions/access.service';
import {
  Access,
  computeAccess,
  PermissionKey,
  permissionsActorCannotGrant,
} from '../permissions/permissions.matrix';
import { LoginLookup } from '../tenancy/login-lookup.service';
import { TenantTransaction, TenantTx } from '../tenancy/tenant-tx.service';
import { InviteMemberDto, UpdateMemberDto } from './dto/team-requests.dto';
import { BranchOptionDto, MemberDto, TeamOptionsDto } from './dto/team-responses.dto';
import { PERMISSIONS } from '../permissions/permissions.matrix';
import { RolesService } from './roles.service';

/** An invitation link works for 7 days: people read email late, but a link must not stay open forever. */
const INVITATION_DAYS = 7;

type MemberRow = User & { role: Role | null; branches: UserBranch[] };

/**
 * The team: who works for the business, what each person may do, and which branches they use.
 *
 * Rules enforced here (every screen and client goes through them):
 *  - THE OWNER IS UNTOUCHABLE from this side: they cannot be edited, disabled or invited. There is exactly one owner
 *    per business for now (ownership transfer is a later feature).
 *  - NO SELF-SERVICE POWER. Nobody can change their own role or permissions, and nobody can hand out a permission,
 *    discount limit or branch access they do not hold themselves (the owner is exempt). See RolesService for why.
 *  - PLAN LIMITS. Active and invited people count against the plan's user limit (Starter 3, Growth 10, Pro 30).
 *    Switched-off people do not.
 *  - SWITCHING SOMEONE OFF is immediate: their sessions end at once and their next request is refused.
 *  - EVERYTHING is written to the audit log, including permission changes.
 *
 * Email addresses are unique across the whole product (one email, one account). Inviting an address that already
 * has an account anywhere answers "this address cannot be invited" for every reason, so an inviter learns only
 * "no", never whose account it is. Inviting is also rate limited, so it cannot be used to scan for accounts.
 */
@Injectable()
export class MembersService {
  private readonly brand: string;
  private readonly webBaseUrl: string;

  constructor(
    config: ConfigService,
    private readonly tenantTx: TenantTx,
    private readonly roles: RolesService,
    private readonly lookup: LoginLookup,
    private readonly authTokens: AuthTokenService,
    private readonly rules: PasswordRules,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {
    this.brand = config.getOrThrow<string>('BRAND_NAME');
    this.webBaseUrl = config.getOrThrow<string>('WEB_BASE_URL').replace(/\/$/, '');
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  /** Everything the team screen needs to draw its forms: roles, branches, the permission catalogue, seats. */
  async options(): Promise<TeamOptionsDto> {
    const [roles, branches, seats] = await Promise.all([
      this.roles.list(),
      this.tenantTx.run((tx) =>
        tx.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      ),
      this.tenantTx.run((tx) => this.countSeats(tx)),
    ]);
    return {
      roles,
      branches: branches.map((branch): BranchOptionDto => ({ id: branch.id, name: branch.name })),
      permissions: Object.entries(PERMISSIONS).map(([key, info]) => ({
        key,
        group: info.group,
        label: info.label,
        description: info.description,
        confidential: 'confidential' in info,
      })),
      seats,
    };
  }

  /** Everyone in the business. */
  async list(): Promise<MemberDto[]> {
    const rows = await this.tenantTx.run((tx) =>
      tx.user.findMany({
        include: { role: true, branches: true },
        orderBy: [{ isOwner: 'desc' }, { fullName: 'asc' }],
      }),
    );
    return rows.map(toMemberDto);
  }

  /** One person. 404 when they are not in this business. */
  async get(memberId: string): Promise<MemberDto> {
    const row = await this.tenantTx.run((tx) => this.loadMember(tx, memberId));
    return toMemberDto(row);
  }

  // ---------------------------------------------------------------------------------------------
  // Inviting
  // ---------------------------------------------------------------------------------------------

  /** Add a person to the team and email them a link to choose their password. */
  async invite(actor: LoadedAccess, dto: InviteMemberDto, info: RequestInfo): Promise<MemberDto> {
    await this.limiter.hit('invite:tenant', actor.tenantId, 20, 60 * 60);

    // The address must be free everywhere (one email, one account). The answer does not say why it is not.
    if (await this.lookup.findByEmail(dto.email)) throw this.cannotInvite();

    let result: {
      row: MemberRow;
      token: string;
      inviterName: string;
      businessName: string;
      roleName: string;
    };
    try {
      result = await this.tenantTx.run(async (tx) => {
        const role = await tx.role.findUnique({ where: { id: dto.roleId } });
        if (!role) throw new DomainError('NOT_FOUND', 'No role with this id.');
        if (role.systemKey === 'OWNER')
          throw new DomainError(
            'FORBIDDEN',
            'The Owner role cannot be given to an invited person.',
          );

        const branchIds = await this.checkedBranchIds(tx, dto.branchIds ?? []);
        this.assertCanHandOut(actor, {
          role,
          extra: dto.extraPermissions ?? [],
          denied: dto.deniedPermissions ?? [],
          discountLimitBp: dto.discountLimitBp ?? null,
          branchIds,
        });
        await this.assertSeatAvailable(tx);

        const created = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email: dto.email,
            fullName: dto.fullName.trim(),
            status: 'INVITED',
            roleId: role.id,
            extraPermissions: dto.extraPermissions ?? [],
            deniedPermissions: dto.deniedPermissions ?? [],
            discountLimitBp: dto.discountLimitBp ?? null,
            createdBy: actor.userId,
            branches: {
              create: branchIds.map((branchId) => ({ tenantId: actor.tenantId, branchId })),
            },
          },
          include: { role: true, branches: true },
        });
        const token = await this.authTokens.issue(
          tx,
          actor.tenantId,
          created.id,
          'INVITATION',
          INVITATION_DAYS * 24 * 60,
        );
        await this.audit.write(
          tx,
          {
            action: 'team.member_invited',
            actorUserId: actor.userId,
            entity: 'user',
            entityId: created.id,
            metadata: {
              role: role.name,
              extra: (dto.extraPermissions ?? []).join(','),
              denied: (dto.deniedPermissions ?? []).join(','),
            },
          },
          info,
        );
        const [inviter, tenant] = await Promise.all([
          tx.user.findUniqueOrThrow({ where: { id: actor.userId } }),
          tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } }),
        ]);
        return {
          row: created,
          token,
          inviterName: inviter.fullName,
          businessName: tenant.name,
          roleName: role.name,
        };
      });
    } catch (error) {
      // Two invitations to the same address at the same moment: the database's one-email rule stops the second.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw this.cannotInvite();
      throw error;
    }

    await this.sendInvitation(
      result.row,
      result.token,
      result.inviterName,
      result.businessName,
      result.roleName,
    );
    return toMemberDto(result.row);
  }

  /** Send a new invitation link to someone who has not accepted yet. Older links stop working. */
  async resendInvitation(actor: LoadedAccess, memberId: string, info: RequestInfo): Promise<void> {
    await this.limiter.hit('invite:resend', memberId, 5, 60 * 60);
    const sent = await this.tenantTx.run(async (tx) => {
      const member = await this.loadMember(tx, memberId);
      if (member.status !== 'INVITED') {
        throw new DomainError(
          'BUSINESS_RULE_VIOLATION',
          'This person has already accepted their invitation.',
        );
      }
      const token = await this.authTokens.issue(
        tx,
        actor.tenantId,
        member.id,
        'INVITATION',
        INVITATION_DAYS * 24 * 60,
      );
      await this.audit.write(
        tx,
        {
          action: 'team.invitation_resent',
          actorUserId: actor.userId,
          entity: 'user',
          entityId: member.id,
        },
        info,
      );
      const [inviter, tenant] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: actor.userId } }),
        tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } }),
      ]);
      return { member, token, inviterName: inviter.fullName, businessName: tenant.name };
    });
    await this.sendInvitation(
      sent.member,
      sent.token,
      sent.inviterName,
      sent.businessName,
      sent.member.role?.name ?? 'Team member',
    );
  }

  /**
   * The invited person opens the link and chooses a password. Opening the link also proves they own the address, so
   * the email counts as confirmed. Works once, within 7 days, and not for someone switched off in the meantime.
   * @throws DomainError INVALID_TOKEN for an unknown, used, expired or revoked link
   * @throws DomainError WEAK_PASSWORD when the password is refused (the link is NOT used up in that case)
   */
  async acceptInvitation(token: string, password: string, info: RequestInfo): Promise<void> {
    await this.limiter.hit('invite:accept', info.ip ?? 'unknown', 10, 60 * 60);
    const parsed = parseToken(token);
    if (!parsed) throw this.invalidToken();

    // Look at the link first, without using it, so a refused password can be corrected without wasting the link.
    const invited = await this.tenantTx.runAs({ tenantId: parsed.tenantId }, async (tx) => {
      const row = await tx.authToken.findUnique({
        where: { tokenHash: hashSecret(parsed.secret) },
        include: { user: true },
      });
      const valid =
        row &&
        row.purpose === 'INVITATION' &&
        !row.usedAt &&
        row.expiresAt > this.clock.now() &&
        row.user.status === 'INVITED';
      return valid ? row.user : null;
    });
    if (!invited) throw this.invalidToken();
    await this.rules.assertAcceptable(password, {
      email: invited.email,
      fullName: invited.fullName,
    });
    const passwordHash = await this.hasher.hash(password);

    const done = await this.tenantTx.runAs(
      { tenantId: parsed.tenantId, userId: invited.id },
      async (tx) => {
        const userId = await this.authTokens.claim(tx, parsed.secret, 'INVITATION');
        if (!userId) return false;
        const now = this.clock.now();
        // `status: INVITED` in the condition: someone switched off after the link was sent must not come back by it.
        const activated = await tx.user.updateMany({
          where: { id: userId, status: 'INVITED' },
          data: { passwordHash, passwordChangedAt: now, status: 'ACTIVE', emailVerifiedAt: now },
        });
        if (activated.count !== 1) return false;
        await this.audit.write(
          tx,
          {
            action: 'team.invitation_accepted',
            actorUserId: userId,
            entity: 'user',
            entityId: userId,
          },
          info,
        );
        return true;
      },
    );
    if (!done) throw this.invalidToken();
  }

  // ---------------------------------------------------------------------------------------------
  // Changing and switching off
  // ---------------------------------------------------------------------------------------------

  /** Change a person's role, extra permissions, branches or discount limit. Applies from their next request. */
  async update(
    actor: LoadedAccess,
    memberId: string,
    dto: UpdateMemberDto,
    info: RequestInfo,
  ): Promise<MemberDto> {
    const row = await this.tenantTx.run(async (tx) => {
      const member = await this.loadMember(tx, memberId);
      this.assertManageable(actor, member);

      const role =
        dto.roleId && dto.roleId !== member.roleId
          ? await tx.role.findUnique({ where: { id: dto.roleId } })
          : member.role;
      if (!role) throw new DomainError('NOT_FOUND', 'No role with this id.');
      if (role.systemKey === 'OWNER')
        throw new DomainError('FORBIDDEN', 'The Owner role cannot be given to anyone else.');

      const branchIds = dto.branchIds
        ? await this.checkedBranchIds(tx, dto.branchIds)
        : member.branches.map((b) => b.branchId);
      const extra = dto.extraPermissions ?? member.extraPermissions;
      const denied = dto.deniedPermissions ?? member.deniedPermissions;
      const limit =
        dto.discountLimitBp === undefined ? member.discountLimitBp : dto.discountLimitBp;

      // Only what is being ADDED needs the actor's authority: compare the person's access before and after.
      const before = computeAccess(
        accessInput(
          member,
          member.role,
          member.extraPermissions,
          member.deniedPermissions,
          member.discountLimitBp,
          member.branches.map((b) => b.branchId),
        ),
      );
      const after = computeAccess(accessInput(member, role, extra, denied, limit, branchIds));
      const added = [...after.permissions].filter((key) => !before.permissions.has(key));
      this.assertCanGrantChange(actor, added, before, after);

      const updated = await tx.user.update({
        where: { id: memberId },
        data: {
          roleId: role.id,
          extraPermissions: extra,
          deniedPermissions: denied,
          discountLimitBp: limit,
          ...(dto.fullName ? { fullName: dto.fullName.trim() } : {}),
        },
        include: { role: true, branches: true },
      });
      if (dto.branchIds) {
        await tx.userBranch.deleteMany({ where: { userId: memberId } });
        await tx.userBranch.createMany({
          data: branchIds.map((branchId) => ({
            tenantId: actor.tenantId,
            userId: memberId,
            branchId,
          })),
        });
      }
      const removed = [...before.permissions].filter((key) => !after.permissions.has(key));
      await this.audit.write(
        tx,
        {
          action: 'team.member_updated',
          actorUserId: actor.userId,
          entity: 'user',
          entityId: memberId,
          metadata: {
            role: role.name,
            added: added.join(','),
            removed: removed.join(','),
            discountLimitBp: after.discountLimitBp,
          },
        },
        info,
      );
      return this.loadMember(tx, updated.id);
    });
    return toMemberDto(row);
  }

  /** Switch a person off: their sessions end at once, and their next request is refused. */
  async disable(actor: LoadedAccess, memberId: string, info: RequestInfo): Promise<MemberDto> {
    const { row, endedSessions } = await this.tenantTx.run(async (tx) => {
      const member = await this.loadMember(tx, memberId);
      this.assertManageable(actor, member);
      if (member.status === 'DISABLED')
        throw new DomainError('CONFLICT', 'This person is already switched off.');
      await tx.user.update({
        where: { id: memberId },
        data: { status: 'DISABLED', disabledAt: this.clock.now(), disabledBy: actor.userId },
      });
      const ended = await this.sessions.revokeAllInTx(tx, memberId, 'USER_DISABLED');
      // A pending invitation link must not bring them back either: retire any unused emailed link.
      await tx.authToken.updateMany({
        where: { userId: memberId, usedAt: null },
        data: { usedAt: this.clock.now() },
      });
      await this.audit.write(
        tx,
        {
          action: 'team.member_disabled',
          actorUserId: actor.userId,
          entity: 'user',
          entityId: memberId,
          metadata: { sessionsEnded: ended.length },
        },
        info,
      );
      return { row: await this.loadMember(tx, memberId), endedSessions: ended };
    });
    // Make their access tokens stop working immediately, not when they expire.
    await this.sessions.afterRevoked(endedSessions);
    return toMemberDto(row);
  }

  /** Switch a person back on. They need a free seat on the plan. */
  async enable(actor: LoadedAccess, memberId: string, info: RequestInfo): Promise<MemberDto> {
    const row = await this.tenantTx.run(async (tx) => {
      const member = await this.loadMember(tx, memberId);
      this.assertManageable(actor, member);
      if (member.status !== 'DISABLED')
        throw new DomainError('CONFLICT', 'This person is not switched off.');
      await this.assertSeatAvailable(tx);
      // Someone who never accepted their invitation goes back to "invited" (they still need a link).
      await tx.user.update({
        where: { id: memberId },
        data: {
          status: member.passwordHash ? 'ACTIVE' : 'INVITED',
          disabledAt: null,
          disabledBy: null,
        },
      });
      await this.audit.write(
        tx,
        {
          action: 'team.member_enabled',
          actorUserId: actor.userId,
          entity: 'user',
          entityId: memberId,
        },
        info,
      );
      return this.loadMember(tx, memberId);
    });
    return toMemberDto(row);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  /** One person with their role and branches. @throws DomainError NOT_FOUND (also for other businesses' people). */
  private async loadMember(tx: TenantTransaction, memberId: string): Promise<MemberRow> {
    const row = await tx.user.findUnique({
      where: { id: memberId },
      include: { role: true, branches: true },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'No team member with this id.');
    return row;
  }

  /**
   * The people this actor may NOT change with the team endpoints: the owner, and themselves.
   * @throws DomainError FORBIDDEN
   */
  private assertManageable(actor: LoadedAccess, member: MemberRow): void {
    if (member.isOwner) throw new DomainError('FORBIDDEN', "The owner's access cannot be changed.");
    if (member.id === actor.userId)
      throw new DomainError(
        'FORBIDDEN',
        'You cannot change your own role or permissions, or switch yourself off.',
      );
  }

  /** Every listed branch must exist in this business and be active. Returns the clean list. */
  private async checkedBranchIds(tx: TenantTransaction, branchIds: string[]): Promise<string[]> {
    const unique = [...new Set(branchIds)];
    if (unique.length === 0) return [];
    const found = await tx.branch.findMany({
      where: { id: { in: unique }, isActive: true },
      select: { id: true },
    });
    if (found.length !== unique.length)
      throw new DomainError('NOT_FOUND', 'One of the branches does not exist.');
    return unique;
  }

  /** Seats used against the plan: everyone who is not switched off. */
  private async countSeats(tx: TenantTransaction): Promise<{ max: number; used: number }> {
    const [tenant, used] = await Promise.all([
      tx.tenant.findFirstOrThrow({ include: { plan: true } }),
      tx.user.count({ where: { status: { not: 'DISABLED' } } }),
    ]);
    return { max: tenant.plan?.maxUsers ?? 1, used };
  }

  private async assertSeatAvailable(tx: TenantTransaction): Promise<void> {
    const seats = await this.countSeats(tx);
    if (seats.used >= seats.max) {
      throw new DomainError(
        'PLAN_LIMIT_REACHED',
        `Your plan allows ${seats.max} ${seats.max === 1 ? 'person' : 'people'} and all seats are used. Switch someone off or upgrade the plan.`,
      );
    }
  }

  /** The no-escalation rule for a NEW person (their whole access is "added"). */
  private assertCanHandOut(
    actor: LoadedAccess,
    input: {
      role: Role;
      extra: PermissionKey[];
      denied: PermissionKey[];
      discountLimitBp: number | null;
      branchIds: string[];
    },
  ): void {
    const access = computeAccess({
      isOwner: false,
      role: input.role,
      extraPermissions: input.extra,
      deniedPermissions: input.denied,
      discountLimitBp: input.discountLimitBp,
      branchIds: input.branchIds,
    });
    this.assertCanGrantChange(actor, [...access.permissions], undefined, access);
  }

  /** What may be ADDED to a person: permissions, a bigger discount limit, or access to every branch. */
  private assertCanGrantChange(
    actor: LoadedAccess,
    added: PermissionKey[],
    before: Access | undefined,
    after: Access,
  ): void {
    const missing = permissionsActorCannotGrant(actor, added);
    if (missing.length > 0) {
      throw new DomainError(
        'FORBIDDEN',
        `You can only grant permissions you hold yourself. Missing: ${missing.join(', ')}.`,
      );
    }
    if (actor.isOwner) return;
    if (
      after.discountLimitBp > (before?.discountLimitBp ?? 0) &&
      after.discountLimitBp > actor.discountLimitBp
    ) {
      throw new DomainError('FORBIDDEN', 'You cannot give a bigger discount limit than your own.');
    }
    const givesAllBranches = after.branchScope === 'ALL' && before?.branchScope !== 'ALL';
    if (givesAllBranches && actor.branchScope !== 'ALL') {
      throw new DomainError(
        'FORBIDDEN',
        'You cannot give access to every branch because you do not have it yourself.',
      );
    }
  }

  private async sendInvitation(
    member: MemberRow,
    token: string,
    inviterName: string,
    businessName: string,
    roleName: string,
  ): Promise<void> {
    try {
      await this.mailer.send(
        invitationEmail({
          to: member.email,
          brand: this.brand,
          name: member.fullName,
          inviterName,
          businessName,
          roleName,
          link: `${this.webBaseUrl}/accept-invitation?token=${encodeURIComponent(token)}`,
          validDays: INVITATION_DAYS,
        }),
      );
    } catch (error) {
      // The person is added either way; the owner can use "send again". Never log the address.
      this.logger.error({ msg: 'Could not send invitation email', err: error });
    }
  }

  private cannotInvite(): DomainError {
    return new DomainError(
      'CONFLICT',
      'This email address cannot be invited. Check the address, or ask the person to use another one.',
    );
  }

  private invalidToken(): DomainError {
    return new DomainError(
      'INVALID_TOKEN',
      'This link is not valid any more. Ask for a new invitation.',
    );
  }
}

/** The input `computeAccess` needs, for a person with a given role and settings. */
function accessInput(
  member: Pick<User, 'isOwner'>,
  role: Role | null,
  extra: string[],
  denied: string[],
  discountLimitBp: number | null,
  branchIds: string[],
) {
  return {
    isOwner: member.isOwner,
    role,
    extraPermissions: extra,
    deniedPermissions: denied,
    discountLimitBp,
    branchIds,
  };
}

/** Describe a person for the API. Never includes a password hash, PIN hash or authenticator secret. */
export function toMemberDto(row: MemberRow): MemberDto {
  const effective = computeAccess(
    accessInput(
      row,
      row.role,
      row.extraPermissions,
      row.deniedPermissions,
      row.discountLimitBp,
      row.branches.map((b) => b.branchId),
    ),
  );
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status,
    isOwner: row.isOwner,
    role: row.role ? { id: row.role.id, name: row.role.name } : null,
    branchIds: row.branches.map((b) => b.branchId),
    extraPermissions: row.extraPermissions,
    deniedPermissions: row.deniedPermissions,
    discountLimitBp: row.discountLimitBp,
    effective: {
      permissions: [...effective.permissions],
      discountLimitBp: effective.discountLimitBp,
      allBranches: effective.branchScope === 'ALL',
    },
    hasPin: row.pinHash !== null,
    totpEnabled: row.totpEnabledAt !== null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    disabledAt: row.disabledAt?.toISOString() ?? null,
  };
}
