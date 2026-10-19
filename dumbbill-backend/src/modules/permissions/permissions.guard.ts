import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Logger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { TenantTx } from '../tenancy/tenant-tx.service';
import { AccessService, LoadedAccess } from './access.service';
import { readRouteAccess } from './permission.decorators';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The signed-in person's permissions for this request. Set by the permissions guard on protected routes. */
      access?: LoadedAccess;
    }
  }
}

/**
 * The lock on every route (registered globally, so no route can opt out by forgetting).
 *
 *   @Public()        let through
 *   @Authenticated() must be signed in (and still active); then through
 *   @Permission(..)  must be signed in AND hold every listed permission, else 403 and an audit entry
 *   nothing / mixed  refused with 403 whoever calls (a bug that a test also catches before release)
 *
 * It does not trust the role named in the access token: it loads the person's current access (see AccessService), so
 * a permission removed a second ago already applies. A refused call is written to the audit log (`authz.denied`),
 * with who tried, what, and from where (story US-SEC-04): the UI hiding a button is never the only protection.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly tenantTx: TenantTx,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = readRouteAccess(this.reflector, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<Request>();
    const route = `${request.method} ${request.route?.path ?? request.path}`;

    if (rule.kind === 'public') return true;

    // Everything else needs a signed-in person (the auth middleware set `request.auth` from a valid token).
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');

    if (rule.kind === 'invalid') {
      // Fail closed: a route nobody described is not open to anyone. The tests stop this reaching production.
      this.logger.error({
        msg: 'Route has no valid access rule; refusing it',
        route,
        problem: rule.problem,
      });
      throw new DomainError('FORBIDDEN', 'This action is not available.');
    }

    request.access = await this.access.load(request.auth.userId);
    if (rule.kind === 'authenticated') return true;

    const missing = rule.permissions.filter((key) => !request.access!.permissions.has(key));
    if (missing.length === 0) return true;

    await this.recordDenial(request, route, missing);
    throw new DomainError('FORBIDDEN', 'You do not have permission to do this.');
  }

  /** Write the refusal to the audit log. A failure to write must never turn into a different answer for the caller. */
  private async recordDenial(request: Request, route: string, missing: string[]): Promise<void> {
    try {
      await this.tenantTx.run((tx) =>
        this.audit.write(
          tx,
          {
            action: 'authz.denied',
            actorUserId: request.auth!.userId,
            entity: 'route',
            entityId: route,
            metadata: { missing: missing.join(',') },
          },
          { ip: request.ip, userAgent: request.headers['user-agent'] },
        ),
      );
    } catch (error) {
      this.logger.error({ msg: 'Could not audit a refused request', route, err: error });
    }
  }
}
