import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Clock } from '../../../common/clock';
import { DomainError } from '../../../common/errors/domain-error';
import { AuditService, RequestInfo } from '../../audit/audit.service';
import { TenantTransaction, TenantTx } from '../../tenancy/tenant-tx.service';
import { describeDevice } from '../domain/device-label';
import { formatToken, generateSecret, hashSecret, parseToken } from '../domain/opaque-token';
import { RevocationList } from './revocation-list';

/** A refresh token works for 30 days after it was issued; every use issues a fresh one ("sliding"). */
export const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * If an already-used refresh token arrives within this many seconds of its first use, it is treated as a harmless
 * race (two browser tabs refreshing at the same moment) and NOT as theft. The loser of the race is simply given a
 * new access token; the refresh token the winner received (shared through the same cookie) stays valid.
 * Later than this, reuse means the token was copied, and the whole session is ended.
 */
export const REUSE_GRACE_SECONDS = 10;

/** Why a session ended. Stored in the database and shown in the audit log. */
export type RevokeReason =
  | 'LOGOUT'
  | 'REVOKED_BY_USER'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'TOKEN_REUSE'
  | 'USER_DISABLED';

/** Which kind of app the session belongs to; it decides how the refresh token is delivered. */
export type ClientType = 'WEB' | 'MOBILE';

/** What `rotate` tells the caller. */
export type RotationResult =
  | { kind: 'rotated'; userId: string; tenantId: string; sessionId: string; refreshToken: string }
  /** A harmless double refresh: issue an access token but no new refresh token. */
  | { kind: 'grace'; userId: string; tenantId: string; sessionId: string };

/** One row of the "your devices" list. */
export interface SessionSummary {
  id: string;
  deviceLabel: string;
  clientType: ClientType;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  /** True for the session making this request. */
  current: boolean;
}

/**
 * Sessions and refresh tokens: creating a sign-in, renewing it, and ending it.
 *
 * ROTATION: a refresh token is good for ONE exchange. Using it returns a brand-new refresh token and marks the old
 * one as used. If an old, used token ever shows up again, somebody copied it: we cannot tell the thief from the
 * real owner, so the whole session ends and both must sign in again ("reuse detection").
 *
 * Only a hash of each token is stored (see domain/opaque-token.ts). The business id travels inside the token so that
 * row-level security can be pointed at the right business before anything is read.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly tenantTx: TenantTx,
    private readonly clock: Clock,
    private readonly revocations: RevocationList,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  /**
   * Start a session for a user who has just proven who they are. Runs inside the caller's transaction so a
   * login either fully happens (session, refresh token, audit row) or not at all.
   * @returns the new session id and the refresh token to give to the client.
   */
  async createInTx(
    tx: TenantTransaction,
    params: { tenantId: string; userId: string; clientType: ClientType; info: RequestInfo },
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const session = await tx.session.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        clientType: params.clientType,
        deviceLabel: describeDevice(params.info.userAgent, params.clientType),
        ipAddress: params.info.ip ?? null,
      },
    });
    const refreshToken = await this.issueRefreshToken(tx, params.tenantId, session.id);
    return { sessionId: session.id, refreshToken };
  }

  /** Create and store the next refresh token of a session; returns the text to give to the client. */
  private async issueRefreshToken(
    tx: TenantTransaction,
    tenantId: string,
    sessionId: string,
  ): Promise<string> {
    const secret = generateSecret();
    await tx.refreshToken.create({
      data: {
        tenantId,
        sessionId,
        tokenHash: hashSecret(secret),
        expiresAt: new Date(this.clock.now().getTime() + REFRESH_TOKEN_LIFETIME_MS),
      },
    });
    return formatToken(tenantId, secret);
  }

  /**
   * Exchange a refresh token for the next one.
   *
   * @throws DomainError INVALID_REFRESH_TOKEN when the token is unknown, expired, already used (theft), or its
   *         session or user is no longer valid. The caller must then send the person to the login screen.
   */
  async rotate(token: string, info: RequestInfo): Promise<RotationResult> {
    const parsed = parseToken(token);
    if (!parsed) throw this.invalid();
    const now = this.clock.now();

    type Outcome = RotationResult | { kind: 'invalid' } | { kind: 'reuse'; sessionId: string };
    const outcome = await this.tenantTx.runAs(
      { tenantId: parsed.tenantId },
      async (tx): Promise<Outcome> => {
        const row = await tx.refreshToken.findUnique({
          where: { tokenHash: hashSecret(parsed.secret) },
          include: { session: { include: { user: { select: { status: true } } } } },
        });
        if (!row) return { kind: 'invalid' };
        const { session } = row;
        if (session.revokedAt || row.expiresAt <= now || session.user.status !== 'ACTIVE') {
          return { kind: 'invalid' };
        }
        const identity = { userId: session.userId, tenantId: row.tenantId, sessionId: session.id };

        if (row.usedAt) {
          // An old token again. Within the grace window it is a double click; later it is theft.
          if (now.getTime() - row.usedAt.getTime() <= REUSE_GRACE_SECONDS * 1000) {
            return { kind: 'grace', ...identity };
          }
          await tx.session.update({
            where: { id: session.id },
            data: { revokedAt: now, revokedReason: 'TOKEN_REUSE' satisfies RevokeReason },
          });
          await this.audit.write(
            tx,
            {
              action: 'auth.refresh_token_reuse',
              actorUserId: session.userId,
              entity: 'session',
              entityId: session.id,
              metadata: {
                reason: 'An already-used refresh token was presented; the session was ended.',
              },
            },
            info,
          );
          return { kind: 'reuse', sessionId: session.id };
        }

        // Claim the token. `usedAt: null` in the condition makes the claim atomic: if two requests race, the
        // database lets exactly one of them change the row, and the other sees count 0.
        const claimed = await tx.refreshToken.updateMany({
          where: { id: row.id, usedAt: null },
          data: { usedAt: now },
        });
        if (claimed.count === 0) return { kind: 'grace', ...identity };

        const refreshToken = await this.issueRefreshToken(tx, row.tenantId, session.id);
        await tx.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
        return { kind: 'rotated', ...identity, refreshToken };
      },
    );

    if (outcome.kind === 'reuse') {
      // The session was ended inside the transaction (now committed). Make its access tokens stop working too.
      await this.revocations.revoke(outcome.sessionId);
      this.logger.warn({
        msg: 'Refresh token reuse detected; session ended',
        event: 'auth.refresh_token_reuse',
      });
      throw this.invalid();
    }
    if (outcome.kind === 'invalid') throw this.invalid();
    return outcome;
  }

  /**
   * End the session a refresh token belongs to (logout). Unknown or expired tokens are ignored: the person wanted
   * to be signed out and already is.
   */
  async revokeByRefreshToken(token: string, info: RequestInfo): Promise<void> {
    const parsed = parseToken(token);
    if (!parsed) return;
    const endedSession = await this.tenantTx.runAs({ tenantId: parsed.tenantId }, async (tx) => {
      const row = await tx.refreshToken.findUnique({
        where: { tokenHash: hashSecret(parsed.secret) },
        include: { session: true },
      });
      if (!row || row.session.revokedAt) return null;
      await this.endSession(tx, row.session.id, row.session.userId, 'LOGOUT', info);
      return row.session.id;
    });
    if (endedSession) await this.revocations.revoke(endedSession);
  }

  /**
   * End one of the signed-in user's own sessions ("sign out that device").
   * @throws DomainError NOT_FOUND when the id is not one of this user's active sessions.
   */
  async revokeOwn(userId: string, sessionId: string, info: RequestInfo): Promise<void> {
    const ended = await this.tenantTx.run(async (tx) => {
      // RLS limits this to the caller's business; the userId condition limits it to the caller's own sessions.
      const session = await tx.session.findFirst({
        where: { id: sessionId, userId, revokedAt: null },
      });
      if (!session) return false;
      await this.endSession(tx, session.id, userId, 'REVOKED_BY_USER', info);
      return true;
    });
    if (!ended) throw new DomainError('NOT_FOUND', 'No active session with this id.');
    await this.revocations.revoke(sessionId);
  }

  /**
   * End every active session of a user, optionally keeping one (the device that is changing the password).
   * Runs inside the caller's transaction. Returns the ended ids: the caller MUST pass them to `afterRevoked`
   * once the transaction has committed, so their access tokens stop working immediately.
   */
  async revokeAllInTx(
    tx: TenantTransaction,
    userId: string,
    reason: RevokeReason,
    keepSessionId?: string,
  ): Promise<string[]> {
    const active = await tx.session.findMany({
      where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
      select: { id: true },
    });
    if (active.length === 0) return [];
    await tx.session.updateMany({
      where: { id: { in: active.map((s) => s.id) } },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
    return active.map((s) => s.id);
  }

  /** Make the access tokens of just-ended sessions stop working. Call after the transaction committed. */
  async afterRevoked(sessionIds: string[]): Promise<void> {
    await Promise.all(sessionIds.map((id) => this.revocations.revoke(id)));
  }

  /** The signed-in user's active sessions, newest activity first. */
  async listFor(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const rows = await this.tenantTx.run((tx) =>
      tx.session.findMany({ where: { userId, revokedAt: null }, orderBy: { lastUsedAt: 'desc' } }),
    );
    return rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      clientType: row.clientType as ClientType,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      current: row.id === currentSessionId,
    }));
  }

  /** Mark one session ended and write the audit row. Inside the caller's transaction. */
  private async endSession(
    tx: TenantTransaction,
    sessionId: string,
    userId: string,
    reason: RevokeReason,
    info: RequestInfo,
  ): Promise<void> {
    await tx.session.update({
      where: { id: sessionId },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
    await this.audit.write(
      tx,
      {
        action: 'auth.session_ended',
        actorUserId: userId,
        entity: 'session',
        entityId: sessionId,
        metadata: { reason },
      },
      info,
    );
  }

  private invalid(): DomainError {
    return new DomainError('INVALID_REFRESH_TOKEN', 'Please sign in again.');
  }
}
