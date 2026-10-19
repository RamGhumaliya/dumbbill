import { SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/http/decorators';
import { PermissionKey } from './permissions.matrix';

/**
 * How every route says who may call it. Exactly ONE of these three must be on every route:
 *
 *   @Public()                      anyone, even without signing in (sign-up, login, health checks)
 *   @Authenticated()               any signed-in person, working with THEIR OWN account (change password, my devices)
 *   @Permission('products.write')  only people who hold that permission (all listed ones, if several)
 *
 * A route that says none of them is refused with 403, whoever calls it (deny by default), and the test
 * `test/integration/permission-matrix.spec.ts` fails the build. So forgetting is impossible to ship by accident.
 */

export const PERMISSION_KEYS = 'dumbbill:permissions';
export const IS_AUTHENTICATED_ONLY = 'dumbbill:authenticatedOnly';

/** Require these permissions (the person must hold ALL of them). */
export const Permission = (...keys: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEYS, keys);

/** Any signed-in person, for routes that only touch their own account. */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_AUTHENTICATED_ONLY, true);

/** What a route declares about who may call it. */
export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permission'; permissions: PermissionKey[] }
  /** Nothing declared (a mistake) or more than one kind declared (a contradiction). The guard refuses these. */
  | { kind: 'invalid'; problem: string };

/**
 * Read what a route declares. A method's own declaration replaces the controller-wide one, so a controller can say
 * `@Authenticated()` for everything and one method can still say `@Permission('team.manage')`.
 * Used by the guard (to decide) and by the tests (to build the route-by-role matrix), so they can never disagree.
 */
export function readRouteAccess(
  reflector: Pick<Reflector, 'get'>,
  targets: [handler: Parameters<Reflector['get']>[1], controller: Parameters<Reflector['get']>[1]],
): RouteAccess {
  // The most specific level that says anything wins: the method first, then the controller.
  for (const target of targets) {
    const isPublic = reflector.get<boolean | undefined>(IS_PUBLIC, target);
    const authenticated = reflector.get<boolean | undefined>(IS_AUTHENTICATED_ONLY, target);
    const permissions = reflector.get<PermissionKey[] | undefined>(PERMISSION_KEYS, target);
    const declared = [
      isPublic ? 'public' : null,
      authenticated ? 'authenticated' : null,
      permissions?.length ? 'permission' : null,
    ].filter((kind): kind is string => kind !== null);

    if (declared.length === 0) continue;
    if (declared.length > 1) {
      return {
        kind: 'invalid',
        problem: `Contradicting access rules declared together: ${declared.join(' and ')}.`,
      };
    }
    if (isPublic) return { kind: 'public' };
    if (authenticated) return { kind: 'authenticated' };
    return { kind: 'permission', permissions: permissions ?? [] };
  }
  return {
    kind: 'invalid',
    problem: 'No access rule declared. Add @Public(), @Authenticated() or @Permission(...).',
  };
}
