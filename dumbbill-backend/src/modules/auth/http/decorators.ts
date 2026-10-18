import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { RequestInfo } from '../../audit/audit.service';
import { AuthenticatedUser } from '../auth.types';

/** Metadata key read by the auth guard. */
export const IS_PUBLIC = 'dumbbill:isPublic';

/**
 * Marks a route as open to people who are not signed in (signup, login, health checks...).
 *
 * Every route is PROTECTED unless it says this: forgetting the decorator makes a route private, never public
 * (deny by default, security.md section 3). Use it sparingly and say so in the route's Swagger description
 * ("Permission: public").
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** The signed-in user of the current request (set by the auth middleware, guaranteed by the guard on protected routes). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.auth) throw new Error('CurrentUser used on a route without authentication.');
    return request.auth;
  },
);

/** The visitor's IP address and browser string, for rate limits, session labels and the audit log. */
export const ClientInfo = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestInfo => {
    const request = context.switchToHttp().getRequest<Request>();
    return { ip: request.ip, userAgent: request.headers['user-agent'] };
  },
);
