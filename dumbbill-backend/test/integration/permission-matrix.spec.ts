import { Controller, Get, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { ALL_PERMISSION_KEYS } from '../../src/modules/permissions/permissions.matrix';
import { createApiDocument } from '../../src/swagger';
import { readRouteAccess, RouteAccess } from '../../src/modules/permissions/permission.decorators';
import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import { addTeamMember, as, createBusiness, Person } from '../support/team-helpers';

/**
 * THE ROUTE-BY-ROLE MATRIX, generated from the real application.
 *
 * Nothing here is a hand-written list of routes. The test asks the running app for every route it has, reads each
 * route's declared access rule (@Public / @Authenticated / @Permission) with the same function the guard uses, and then
 * calls EVERY route as five different callers (anonymous, owner, admin, cashier, a person whose role has no permissions)
 * to check the answer is exactly what the rule says:
 *
 *   - anonymous callers get 401 on every protected route;
 *   - a caller who lacks a required permission gets 403 AND an `authz.denied` entry in the audit log (US-SEC-04);
 *   - a caller who holds the permission is never stopped by the permission guard.
 *
 * A new route is covered the moment it exists. A route with no declared rule fails the build (and, if it ever reached
 * production, the guard refuses it for everybody). The Swagger text must also agree with the declared rule, so the API
 * manual cannot say one thing while the code does another.
 */

/** A route nobody described: used to prove the checks really do catch a forgotten rule. */
@Controller('v1/test-forgotten')
class ForgottenController {
  @Get('thing')
  thing(): string {
    return 'should never be reachable';
  }
}

let t: AuthTestApp;
let owner: Person;
let admin: Person;
let cashier: Person;
let nobody: Person;

interface RouteInfo {
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
function discoverRoutes(): RouteInfo[] {
  const discovery = new DiscoveryService(t.app.get(ModulesContainer, { strict: false }));
  const scanner = new MetadataScanner();
  const reflector = t.app.get(Reflector);
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
      const path = `/${[base, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
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
function concrete(path: string): string {
  return path.replace(/:[A-Za-z]+/g, '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b');
}

beforeAll(async () => {
  t = await createAuthTestApp({ extraControllers: [ForgottenController] });
  owner = await createBusiness(t);
  admin = await addTeamMember(t, owner, 'ADMIN');
  cashier = await addTeamMember(t, owner, 'CASHIER');
  const noRole = await as(t, owner).post('/v1/team/roles', {
    name: 'No permissions',
    permissions: [],
  });
  nobody = await addTeamMember(t, owner, 'CASHIER', { roleId: noRole.body.id }, 'nobody');
});

afterAll(async () => {
  await t.close();
});

describe('every route declares who may call it', () => {
  it('finds the routes of the application (the matrix is not empty)', () => {
    const routes = discoverRoutes();
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.some((r) => r.path === '/v1/team/members' && r.method === 'POST')).toBe(true);
    expect(routes.some((r) => r.path === '/healthz')).toBe(true);
  });

  it('no route is missing a rule or has contradicting rules (other than the deliberate test route)', () => {
    const offenders = discoverRoutes()
      .filter(
        (route) => route.rule.kind === 'invalid' && route.controller !== 'ForgottenController',
      )
      .map(
        (route) =>
          `${route.method} ${route.path} (${route.controller}.${route.handler}): ${(route.rule as { problem: string }).problem}`,
      );
    expect(offenders).toEqual([]);
  });

  it('DOES catch a route nobody described (this check is not asleep)', () => {
    const forgotten = discoverRoutes().find((route) => route.controller === 'ForgottenController');
    expect(forgotten?.rule.kind).toBe('invalid');
  });

  it('refuses a forgotten route for EVERYONE, even the owner (deny by default)', async () => {
    for (const person of [owner, admin, cashier]) {
      const res = await as(t, person).get('/v1/test-forgotten/thing');
      expect(res.status).toBe(403);
    }
    expect((await t.http().get('/v1/test-forgotten/thing')).status).toBe(401);
  });

  it('uses only known permission names in @Permission(...)', () => {
    const known = new Set<string>(ALL_PERMISSION_KEYS);
    for (const route of discoverRoutes()) {
      if (route.rule.kind === 'permission')
        for (const key of route.rule.permissions) expect(known.has(key)).toBe(true);
    }
  });
});

describe('the API manual agrees with the code', () => {
  it('every route\'s "Permission:" line in Swagger matches what the route declares', () => {
    const document = createApiDocument(t.app);
    const problems: string[] = [];
    for (const route of discoverRoutes()) {
      if (route.controller === 'ForgottenController' || route.rule.kind === 'invalid') continue;
      const operation = (
        document.paths[route.path.replace(/:([A-Za-z]+)/g, '{$1}')] as
          Record<string, { description?: string }> | undefined
      )?.[route.method.toLowerCase()];
      const line =
        /Permission:\s*([^\n]*)/.exec(operation?.description ?? '')?.[1]?.toLowerCase() ?? '';
      const label = `${route.method} ${route.path}`;
      if (!operation) problems.push(`${label}: missing from Swagger`);
      else if (route.rule.kind === 'public' && !line.startsWith('public'))
        problems.push(`${label}: declared public, Swagger says "${line}"`);
      else if (route.rule.kind === 'authenticated' && !line.startsWith('any signed-in user'))
        problems.push(`${label}: declared authenticated, Swagger says "${line}"`);
      else if (route.rule.kind === 'permission') {
        for (const key of route.rule.permissions)
          if (!line.includes(key))
            problems.push(`${label}: requires ${key}, Swagger says "${line}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the route-by-role matrix', () => {
  it('anonymous callers are stopped at every protected route with 401 UNAUTHENTICATED, and never at a public one', async () => {
    const wrong: string[] = [];
    for (const route of discoverRoutes().filter((r) => r.controller !== 'ForgottenController')) {
      const res = await t
        .http()
        [route.method.toLowerCase() as 'get'](concrete(route.path))
        .set('X-Forwarded-For', t.freshIp())
        .send({});
      const unauthenticated = res.status === 401 && res.body.code === 'UNAUTHENTICATED';
      if (route.rule.kind === 'public' && unauthenticated)
        wrong.push(`${route.method} ${route.path}: public route demanded a login`);
      if (route.rule.kind !== 'public' && !unauthenticated)
        wrong.push(
          `${route.method} ${route.path}: protected route answered ${res.status} without a login`,
        );
    }
    expect(wrong).toEqual([]);
  });

  it.each([
    ['owner', () => owner],
    ['admin', () => admin],
    ['cashier', () => cashier],
    ['a person whose role has no permissions', () => nobody],
  ])('as %s, every route answers exactly as its rule says', async (_label, who) => {
    const person = who();
    const me = await as(t, person).get('/v1/auth/me');
    const held = new Set<string>(me.body.access.permissions);
    const wrong: string[] = [];

    for (const route of discoverRoutes().filter((r) => r.controller !== 'ForgottenController')) {
      const entity = `${route.method} ${route.path}`;
      const before = await t.db.owner.auditLog.count({
        where: { actorUserId: person.userId, action: 'authz.denied', entityId: entity },
      });
      const res = await t
        .http()
        [route.method.toLowerCase() as 'get'](concrete(route.path))
        .set('Authorization', `Bearer ${person.accessToken}`)
        .set('X-Forwarded-For', t.freshIp())
        .send({});
      const denials =
        (await t.db.owner.auditLog.count({
          where: { actorUserId: person.userId, action: 'authz.denied', entityId: entity },
        })) - before;

      const shouldBeDenied =
        route.rule.kind === 'permission' && !route.rule.permissions.every((key) => held.has(key));
      if (shouldBeDenied) {
        if (res.status !== 403)
          wrong.push(
            `${entity}: lacks ${(route.rule as { permissions: string[] }).permissions.join('+')} but got ${res.status}`,
          );
        if (denials !== 1)
          wrong.push(`${entity}: refused but ${denials} audit entries were written (expected 1)`);
      } else {
        if (denials !== 0)
          wrong.push(`${entity}: allowed by its rule but the permission guard refused it`);
        if (res.status === 401 && res.body.code === 'UNAUTHENTICATED')
          wrong.push(`${entity}: signed-in caller was told to sign in`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the people with no permissions are refused on ALL permission routes, and the owner on none', async () => {
    const routes = discoverRoutes().filter((r) => r.rule.kind === 'permission');
    expect(routes.length).toBeGreaterThan(10);
    const sample = routes.find((r) => r.method === 'GET' && r.path === '/v1/team/members')!;
    expect((await as(t, nobody).get(sample.path)).status).toBe(403);
    expect((await as(t, owner).get(sample.path)).status).toBe(200);
  });
});
