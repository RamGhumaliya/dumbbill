import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ACCESS_TOKEN_LIFETIME_SECONDS } from '../tokens/access-token.service';
import { EphemeralStore } from '../store/ephemeral-store';

/**
 * Ended sessions whose access tokens could still be alive.
 *
 * An access token is checked without touching the database (that is what makes it fast), so on its own
 * it keeps working until it expires, up to 15 minutes after the person logged out or an owner revoked
 * the session. This list closes that gap: when a session ends, its id is remembered here for exactly as
 * long as any of its tokens could still be valid, and the sign-in check asks the list on every request.
 *
 * It fails open if Redis is down (a revoked session may then work for up to 15 minutes at worst), the same
 * trade-off as the rate limiter and described in ADR 006.
 */
@Injectable()
export class RevocationList {
  constructor(
    private readonly store: EphemeralStore,
    private readonly logger: Logger,
  ) {}

  /** Remember that this session has ended. */
  async revoke(sessionId: string): Promise<void> {
    try {
      // A little longer than the token lifetime, to cover clock differences.
      await this.store.set(`revoked:${sessionId}`, ACCESS_TOKEN_LIFETIME_SECONDS + 60);
    } catch (error) {
      this.logger.error({ msg: 'Could not record a revoked session', err: error });
    }
  }

  /** Has this session ended? */
  async isRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.store.remainingSeconds(`revoked:${sessionId}`)) > 0;
    } catch (error) {
      this.logger.error({ msg: 'Could not check the revoked-session list', err: error });
      return false;
    }
  }
}
