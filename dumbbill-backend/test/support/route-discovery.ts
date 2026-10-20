import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { readRouteAccess, RouteAccess } from '../../src/modules/permissions/permission.decorators';

/**
 * Finds every route of the running application, so the security sweeps (route-by-role matrix, cross-business sweep)
 * are generated from the real code and a new route is covered the moment it exists. Nothing here is a hand-written
 * list of routes.
 */

/** One route of the application with the access rule it declares. */
export interface RouteInfo {
  method: string;
  /** The Express-style path, for example `/v1/team/members/:memberId`. */
  path: string;
  controller: string;
  handler: string;
  rule: RouteAccess;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

/** Every route of the application with what it declares. */
export function discoverRoutes(app: INestApplication): RouteInfo[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer, { strict: false }));
  const scanner = new MetadataScanner();
  const reflector = app.get(Reflector);
  const routes: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype;
    if (!controller || !wrapper.instance) continue;
    const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    for (const name of scanner.getAllMethodNames(
      Object.getPrototypeOf(wrapper.instance) as object,
    )) {
      const handler = (wrapper.instance as Record<string, (...args: unknown[]) => unknown>)[name]!;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method === undefined) continue;
      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      // A route declared with `@Get()` or `@Get('/')` has no trailing slash once Express registers it.
      const path = `/${[base, sub].filter(Boolean).join('/')}`
        .replace(/\/+/g, '/')
        .replace(/(.)\/$/, '$1');
      routes.push({
        method: METHOD_NAMES[method] ?? String(method),
        path,
        controller: controller.name,
        handler: name,
        rule: readRouteAccess(reflector, [handler, controller]),
      });
    }
  }
  return routes;
}

/** Fill the `:params` of a path with a valid-looking id, so the request gets past routing. */
export function concrete(path: string): string {
  return path.replace(/:[A-Za-z]+/g, '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b');
}
