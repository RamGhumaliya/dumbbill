import { Injectable } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import { Clock } from '../../common/clock';
import { TenantTransaction } from '../tenancy/tenant-tx.service';
import { formatToken, generateSecret, hashSecret } from './domain/opaque-token';

/**
 * One-time tokens that travel by email: "confirm your address", "reset your password", "you are invited".
 *
 * Shared by the sign-in flows and the team invitations so every emailed link behaves identically: random and long,
 * only a hash stored, single use, expiring, and the newest link of a kind replaces older ones. The business id is
 * part of the token text (`<tenantId>.<secret>`, see domain/opaque-token.ts) so row-level security can be pointed at
 * the right business before anything is read.
 */
@Injectable()
export class AuthTokenService {
  constructor(private readonly clock: Clock) {}

  /** Create a one-time emailed token (replacing any earlier unused one of the same kind) and return its text. */
  async issue(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
    purpose: AuthTokenPurpose,
    validMinutes: number,
  ): Promise<string> {
    const now = this.clock.now();
    // Only the newest link should work: older unused ones are retired.
    await tx.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    const secret = generateSecret();
    await tx.authToken.create({
      data: {
        tenantId,
        userId,
        purpose,
        tokenHash: hashSecret(secret),
        expiresAt: new Date(now.getTime() + validMinutes * 60 * 1000),
      },
    });
    return formatToken(tenantId, secret);
  }

  /**
   * Use up a one-time token. Returns the user it belongs to, or null if it is unknown, the wrong kind, expired or
   * already used. The "used" change and the check happen in ONE database statement, so two people clicking the same
   * link at the same instant cannot both succeed.
   */
  async claim(
    tx: TenantTransaction,
    secret: string,
    purpose: AuthTokenPurpose,
  ): Promise<string | null> {
    const now = this.clock.now();
    const row = await tx.authToken.findUnique({ where: { tokenHash: hashSecret(secret) } });
    if (!row || row.purpose !== purpose) return null;
    const claimed = await tx.authToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return claimed.count === 1 ? row.userId : null;
  }
}
