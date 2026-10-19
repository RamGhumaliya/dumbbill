import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../../src/modules/auth/http/decorators';
import {
  Authenticated,
  Permission,
  readRouteAccess,
} from '../../src/modules/permissions/permission.decorators';
import { BranchScope } from '../../src/modules/permissions/branch-scope';
import {
  ALL_PERMISSION_KEYS,
  Access,
  AccessInput,
  CONFIDENTIAL_PERMISSIONS,
  computeAccess,
  isPermissionKey,
  PERMISSIONS,
  permissionsActorCannotGrant,
  ROLE_PRESETS,
  SystemRoleKey,
} from '../../src/modules/permissions/permissions.matrix';
import { pinWeakness } from '../../src/modules/team/pin.service';

/**
 * The permission rules, tested as plain logic (no database): the catalogue is well formed, the three built-in roles
 * are what the product promises (above all: a cashier never gets cost or profit), a person's access is worked out
 * correctly, and the rules for "who may hand out what" hold.
 */
describe('the permission catalogue', () => {
  it('names every permission like `area.action`, with a group, label and description', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      const info = PERMISSIONS[key];
      expect(info.group.length).toBeGreaterThan(2);
      expect(info.label.length).toBeGreaterThan(4);
      expect(info.description.length).toBeGreaterThan(15);
    }
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('contains the permissions listed in the security design', () => {
    for (const key of [
      'products.read',
      'products.write',
      'products.cost.read',
      'pricing.write',
      'purchases.write',
      'stock.adjust',
      'stock.transfer',
      'pos.sell',
      'discount.apply',
      'discount.approve',
      'invoice.cancel',
      'invoice.refund',
      'reports.sales',
      'reports.profit',
      'team.manage',
      'settings.manage',
      'loyalty.manage',
      'audit.read',
    ]) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });

  it('recognises only real keys (not look-alikes or prototype names)', () => {
    for (const bad of [
      '',
      'products',
      'PRODUCTS.READ',
      'products.read ',
      'toString',
      '__proto__',
      'constructor',
      42,
      null,
      undefined,
    ]) {
      expect(isPermissionKey(bad)).toBe(false);
    }
  });

  it('flags exactly the permissions that reveal cost or profit as confidential', () => {
    expect([...CONFIDENTIAL_PERMISSIONS].sort()).toEqual(['products.cost.read', 'reports.profit']);
  });
});

describe('the built-in roles', () => {
  const keys = Object.keys(ROLE_PRESETS) as SystemRoleKey[];

  it('only use permissions that exist, each at most once', () => {
    for (const key of keys) {
      for (const permission of ROLE_PRESETS[key].permissions)
        expect(isPermissionKey(permission)).toBe(true);
      expect(new Set(ROLE_PRESETS[key].permissions).size).toBe(
        ROLE_PRESETS[key].permissions.length,
      );
    }
  });

  it('CASHIER never gets cost or profit (the cashier-leak guarantee starts here)', () => {
    for (const permission of ROLE_PRESETS.CASHIER.permissions) {
      expect(CONFIDENTIAL_PERMISSIONS).not.toContain(permission);
    }
    expect(ROLE_PRESETS.CASHIER.permissions).toEqual([
      'products.read',
      'pos.sell',
      'discount.apply',
    ]);
  });

  it('CASHIER is limited to a 5% discount and to assigned branches; ADMIN to 20% across all branches', () => {
    expect(ROLE_PRESETS.CASHIER).toMatchObject({ discountLimitBp: 500, allBranches: false });
    expect(ROLE_PRESETS.ADMIN).toMatchObject({ discountLimitBp: 2000, allBranches: true });
  });

  it('ADMIN does not manage the team or the business settings unless the owner adds it', () => {
    expect(ROLE_PRESETS.ADMIN.permissions).not.toContain('team.manage');
    expect(ROLE_PRESETS.ADMIN.permissions).not.toContain('settings.manage');
  });

  it('give the same permission sets as the snapshot in the migration that backfilled existing businesses', () => {
    // If a preset changes on purpose, the migration snapshot stays (it records history); this test just makes the
    // difference visible so it is a conscious decision.
    expect([...ROLE_PRESETS.ADMIN.permissions].sort()).toEqual(
      [
        'products.read',
        'products.write',
        'products.cost.read',
        'pricing.write',
        'purchases.write',
        'stock.adjust',
        'stock.transfer',
        'pos.sell',
        'discount.apply',
        'discount.approve',
        'invoice.cancel',
        'invoice.refund',
        'reports.sales',
        'reports.profit',
        'loyalty.manage',
        'audit.read',
      ].sort(),
    );
  });
});

/** Build an access input, with sensible defaults, overriding only what a test cares about. */
function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    isOwner: false,
    role: {
      systemKey: 'CASHIER',
      permissions: ['products.read', 'pos.sell'],
      discountLimitBp: 500,
      allBranches: false,
    },
    extraPermissions: [],
    deniedPermissions: [],
    discountLimitBp: null,
    branchIds: [],
    ...overrides,
  };
}

describe('computeAccess', () => {
  it("gives a person their role's permissions", () => {
    const access = computeAccess(input());
    expect([...access.permissions].sort()).toEqual(['pos.sell', 'products.read']);
    expect(access.isOwner).toBe(false);
  });

  it('adds the extras the owner granted', () => {
    const access = computeAccess(input({ extraPermissions: ['stock.adjust'] }));
    expect(access.permissions.has('stock.adjust')).toBe(true);
    expect(access.permissions.has('pos.sell')).toBe(true);
  });

  it('removes what was taken away, and taking away wins over the role AND over extras', () => {
    const access = computeAccess(
      input({
        extraPermissions: ['stock.adjust'],
        deniedPermissions: ['pos.sell', 'stock.adjust'],
      }),
    );
    expect([...access.permissions]).toEqual(['products.read']);
  });

  it('ignores unknown keys instead of trusting them', () => {
    const access = computeAccess(
      input({
        role: {
          systemKey: null,
          permissions: ['products.read', 'invoice.delete_everything'],
          discountLimitBp: 0,
          allBranches: false,
        },
        extraPermissions: ['root'],
      }),
    );
    expect([...access.permissions]).toEqual(['products.read']);
  });

  it('a person with no role has no permissions (deny by default)', () => {
    const access = computeAccess(input({ role: null }));
    expect(access.permissions.size).toBe(0);
    expect(access.discountLimitBp).toBe(0);
    expect(access.branchScope).toEqual([]);
  });

  it('the owner holds EVERY permission, in every branch, whatever else is set', () => {
    for (const owner of [
      input({ isOwner: true, role: null }),
      input({ isOwner: true, deniedPermissions: [...ALL_PERMISSION_KEYS] }),
      input({
        isOwner: false,
        role: { systemKey: 'OWNER', permissions: [], discountLimitBp: 0, allBranches: false },
      }),
    ]) {
      const access = computeAccess(owner);
      expect(access.isOwner).toBe(true);
      expect(access.permissions.size).toBe(ALL_PERMISSION_KEYS.length);
      expect(access.branchScope).toBe('ALL');
      expect(access.discountLimitBp).toBe(10_000);
    }
  });

  it("uses the person's own discount limit when set (even 0), else the role's", () => {
    expect(computeAccess(input()).discountLimitBp).toBe(500);
    expect(computeAccess(input({ discountLimitBp: 100 })).discountLimitBp).toBe(100);
    expect(computeAccess(input({ discountLimitBp: 0 })).discountLimitBp).toBe(0);
  });

  it('limits branches to the assigned ones, unless the role covers all branches', () => {
    expect(computeAccess(input({ branchIds: ['b1', 'b2'] })).branchScope).toEqual(['b1', 'b2']);
    const all = computeAccess(
      input({
        role: { systemKey: 'ADMIN', permissions: [], discountLimitBp: 0, allBranches: true },
        branchIds: ['b1'],
      }),
    );
    expect(all.branchScope).toBe('ALL');
  });
});

describe('permissionsActorCannotGrant (no escalation)', () => {
  const actor = (permissions: string[], isOwner = false): Access =>
    computeAccess(
      input({
        isOwner,
        role: { systemKey: 'ADMIN', permissions, discountLimitBp: 0, allBranches: true },
      }),
    );

  it('lets the owner grant anything', () => {
    expect(permissionsActorCannotGrant(actor([], true), ALL_PERMISSION_KEYS)).toEqual([]);
  });

  it('lets others grant only what they hold, and names what they cannot', () => {
    const manager = actor(['team.manage', 'products.read']);
    expect(permissionsActorCannotGrant(manager, ['products.read'])).toEqual([]);
    expect(
      permissionsActorCannotGrant(manager, ['products.read', 'reports.profit', 'settings.manage']),
    ).toEqual(['reports.profit', 'settings.manage']);
  });

  it('counts a repeated permission once', () => {
    expect(permissionsActorCannotGrant(actor([]), ['pos.sell', 'pos.sell'])).toEqual(['pos.sell']);
  });
});

describe('branch scope', () => {
  it('lets a person with all branches use any branch and apply no filter', () => {
    const scope = new BranchScope({ branchScope: 'ALL' });
    expect(scope.isAll).toBe(true);
    expect(scope.allows('anything')).toBe(true);
    expect(scope.filter()).toBeUndefined();
    expect(() => scope.assert('x')).not.toThrow();
  });

  it('limits a person to their assigned branches, filters lists to them, and refuses others', () => {
    const scope = new BranchScope({ branchScope: ['b1', 'b2'] });
    expect(scope.allows('b1')).toBe(true);
    expect(scope.allows('b3')).toBe(false);
    expect(scope.filter()).toEqual({ in: ['b1', 'b2'] });
    expect(() => scope.assert('b3')).toThrow(/access to this branch/);
  });

  it('a person with no branches may use none (and a list filter that matches nothing)', () => {
    const scope = new BranchScope({ branchScope: [] });
    expect(scope.allows('b1')).toBe(false);
    expect(scope.filter()).toEqual({ in: [] });
  });
});

describe('route access declarations', () => {
  const reflector = new Reflector();

  /** Read what a handler of a throwaway controller declares. */
  function declared(controller: new () => object, method: string) {
    const prototype = controller.prototype as Record<string, (...args: unknown[]) => unknown>;
    return readRouteAccess(reflector, [prototype[method]!, controller]);
  }

  it('reads @Public, @Authenticated and @Permission', () => {
    @Controller()
    class Sample {
      @Public() @Get() open(): void {}
      @Authenticated() @Get() mine(): void {}
      @Permission('products.write', 'pricing.write') @Get() guarded(): void {}
    }
    expect(declared(Sample, 'open')).toEqual({ kind: 'public' });
    expect(declared(Sample, 'mine')).toEqual({ kind: 'authenticated' });
    expect(declared(Sample, 'guarded')).toEqual({
      kind: 'permission',
      permissions: ['products.write', 'pricing.write'],
    });
  });

  it('flags a route that declares nothing', () => {
    @Controller()
    class Forgotten {
      @Get() oops(): void {}
    }
    const rule = declared(Forgotten, 'oops');
    expect(rule.kind).toBe('invalid');
    expect(JSON.stringify(rule)).toMatch(/No access rule declared/);
  });

  it('flags a route that declares two different kinds', () => {
    @Controller()
    class Contradiction {
      @Public() @Permission('pos.sell') @Get() both(): void {}
    }
    expect(JSON.stringify(declared(Contradiction, 'both'))).toMatch(/Contradicting/);
  });

  it("applies a controller-wide rule to every method, and lets a method's own rule replace it", () => {
    @Authenticated()
    @Controller()
    class AccountArea {
      @Get() inherited(): void {}
      @Permission('team.manage') @Get() stricter(): void {}
    }
    expect(declared(AccountArea, 'inherited')).toEqual({ kind: 'authenticated' });
    expect(declared(AccountArea, 'stricter')).toEqual({
      kind: 'permission',
      permissions: ['team.manage'],
    });
  });

  it('an empty @Permission() declares nothing (it cannot be used to open a route by accident)', () => {
    @Controller()
    class Empty {
      @Permission() @Get() none(): void {}
    }
    expect(declared(Empty, 'none').kind).toBe('invalid');
  });
});

describe('approval PINs', () => {
  it('accepts ordinary PINs', () => {
    for (const pin of ['804213', '370419', '590126']) expect(pinWeakness(pin)).toBeNull();
  });

  it('refuses repeated digits, straight runs and famous PINs', () => {
    for (const pin of [
      '000000',
      '111111',
      '999999',
      '123456',
      '654321',
      '234567',
      '012345',
      '121212',
      '112233',
      '123123',
    ]) {
      expect(pinWeakness(pin)).not.toBeNull();
    }
  });
});
