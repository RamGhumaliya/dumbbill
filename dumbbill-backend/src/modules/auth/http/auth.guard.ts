import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError } from '../../../common/errors/domain-error';
import { IS_PUBLIC } from './decorators';

/**
 * The front door: applied to EVERY route of the API (registered globally in AuthModule).
 *
 * A route is open only if it is marked `@Public()`. Otherwise the request must carry a valid access token
 * (checked earlier by `AuthContextMiddleware`), or it gets 401. This is "deny by default": a developer who
 * forgets to think about security gets a locked door, not an open one.
 *
 * It only answers "are you signed in?". "Are you allowed to do THIS?" (permissions per role) is added in P1-2.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
    return true;
  }
}
