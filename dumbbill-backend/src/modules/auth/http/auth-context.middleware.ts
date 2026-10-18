import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RevocationList } from '../session/revocation-list';
import { AccessTokenService } from '../tokens/access-token.service';
import { runWithTenantContext } from '../../tenancy/tenant-context';

/**
 * Looks at the `Authorization: Bearer <token>` header of EVERY request and, if the token is good, does two things:
 *   1. records who is calling on `request.auth`;
 *   2. runs the rest of the request inside the tenant context, so the database layer (`TenantTx`) knows which
 *      business to lock queries to, and the logger can add `tenantId` to every line.
 *
 * It never rejects a request. A missing or bad token just means "not signed in"; the auth GUARD decides whether
 * that matters for the route (public routes carry on, protected routes get a 401). Keeping the two jobs apart is
 * needed because only middleware can wrap the rest of the request in the tenant context.
 *
 * A token is refused when its signature or expiry is wrong, it was made for another audience (a customer token),
 * or its session has been ended (logout, revoked, password changed).
 */
@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly revocations: RevocationList,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();

    const claims = await this.tokens.verify(header.slice('Bearer '.length).trim());
    if (!claims || (await this.revocations.isRevoked(claims.sessionId))) return next();

    req.auth = { userId: claims.userId, tenantId: claims.tenantId, sessionId: claims.sessionId };
    runWithTenantContext({ tenantId: claims.tenantId, userId: claims.userId }, () => next());
  }
}
