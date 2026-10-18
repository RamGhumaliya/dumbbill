import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { Logger } from 'nestjs-pino';
import { Clock } from '../../../common/clock';

/**
 * Access tokens: the short-lived "pass" the apps send with every request.
 *
 * It is a signed JWT. The server can check it with only the PUBLIC key and no database call, which keeps
 * every request fast; the price is that it cannot be taken back, so it is short-lived (15 minutes) and a
 * list of ended sessions (revocation-list.ts) closes the gap.
 *
 * Claims: `sub` = user id, `tid` = business id, `sid` = session id, `aud` = who it is for, `exp` = expiry.
 *
 * `aud` (audience) keeps the two kinds of user apart: staff tokens say "dumbbill-staff". The customer app
 * (Phase 3) gets its own audience, so a customer token can never open a staff route, whatever else is wrong.
 *
 * Signing uses Ed25519 ("EdDSA"). Only that one algorithm is accepted when checking, which blocks the classic
 * trick of presenting a token that claims a weaker algorithm. Each token header carries a key id (`kid`), so a
 * key can be rotated: new tokens use the new key while the old public key can still verify older tokens
 * (JWT_PREVIOUS_PUBLIC_KEYS), see docs/runbooks/rotate-secrets.md.
 */

/** How long an access token works. */
export const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;

/** Who a token is for. */
export const STAFF_AUDIENCE = 'dumbbill-staff';
const ISSUER = 'dumbbill';

/** What a verified token tells us. */
export interface AccessClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
}

@Injectable()
export class AccessTokenService {
  private readonly signingKey: KeyObject;
  private readonly keyId: string;
  /** kid -> public key, for the current key and any previous ones still accepted. */
  private readonly verifyKeys = new Map<string, KeyObject>();

  constructor(
    config: ConfigService,
    private readonly clock: Clock,
    logger: Logger,
  ) {
    this.keyId = config.getOrThrow<string>('JWT_KEY_ID');
    const configured = config.get<string>('JWT_PRIVATE_KEY');
    if (configured) {
      this.signingKey = createPrivateKey(Buffer.from(configured, 'base64').toString('utf8'));
    } else {
      // Development convenience: a new key each start. Everyone is simply asked to refresh once.
      logger.warn({
        msg: 'JWT_PRIVATE_KEY is not set: using a throw-away signing key. Never do this in production.',
      });
      this.signingKey = generateKeyPairSync('ed25519').privateKey;
    }
    this.verifyKeys.set(this.keyId, createPublicKey(this.signingKey));

    for (const pair of (config.get<string>('JWT_PREVIOUS_PUBLIC_KEYS') ?? '')
      .split(',')
      .filter(Boolean)) {
      const separator = pair.indexOf(':');
      const kid = pair.slice(0, separator);
      this.verifyKeys.set(
        kid,
        createPublicKey(Buffer.from(pair.slice(separator + 1), 'base64').toString('utf8')),
      );
    }
  }

  /** Create an access token for a signed-in session. */
  async sign(claims: AccessClaims): Promise<{ token: string; expiresInSeconds: number }> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const token = await new SignJWT({ tid: claims.tenantId, sid: claims.sessionId })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keyId })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(STAFF_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS)
      .sign(this.signingKey);
    return { token, expiresInSeconds: ACCESS_TOKEN_LIFETIME_SECONDS };
  }

  /** Check a token. Returns its claims, or null if it is forged, expired, for another audience or malformed. */
  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid ? this.verifyKeys.get(header.kid) : undefined;
          if (!key) throw new Error('Unknown signing key.');
          return key;
        },
        {
          algorithms: ['EdDSA'],
          issuer: ISSUER,
          audience: STAFF_AUDIENCE,
          currentDate: this.clock.now(),
        },
      );
      const { sub, tid, sid } = payload as { sub?: string; tid?: unknown; sid?: unknown };
      if (!sub || typeof tid !== 'string' || typeof sid !== 'string') return null;
      return { userId: sub, tenantId: tid, sessionId: sid };
    } catch {
      return null;
    }
  }
}
