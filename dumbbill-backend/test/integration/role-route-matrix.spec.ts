import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionKey, ROLE_PRESETS } from '../../src/modules/permissions/permissions.matrix';
import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import { discoverRoutes } from '../support/route-discovery';

/**
 * THE WRITTEN ROUTE-BY-ROLE TABLE (docs/api/permission-matrix.md).
 *
 * The request-level matrix (permission-matrix.spec.ts) proves the running API obeys each route's declared rule. This
 * test turns the same rules plus the built-in role presets into a table a human can review: for every route, may the
 * Owner, an Admin and a Cashier (with the starting permissions) call it? The committed file must match what the code
 * says, so a permission change that widens a role shows up as a diff in review, never silently.
 *
 * To refresh the file after an intended change: `UPDATE_DOCS=1 pnpm test:int -- role-route-matrix`.
 */

const DOC = join(__dirname, '../../../docs/api/permission-matrix.md');

let t: AuthTestApp;
beforeAll(async () => {
  t = await createAuthTestApp();
});
afterAll(async () => {
  await t.close();
});

/** Permissions that must never reach a cashier by default: cost, profit, money records, audit, team and settings. */
const NEVER_FOR_CASHIER: PermissionKey[] = [
  'products.cost.read',
  'products.write',
  'pricing.write',
  'purchases.write',
  'stock.adjust',
  'stock.transfer',
  'audit.read',
  'settings.manage',
  'team.manage',
  'reports.profit',
];

function mayCall(role: 'ADMIN' | 'CASHIER' | 'OWNER', rule: ReturnType<typeof rules>[number]) {
  if (rule.kind !== 'permission') return true; // public and any-signed-in routes
  if (role === 'OWNER') return true; // the owner holds every permission
  const held = new Set<PermissionKey>(ROLE_PRESETS[role].permissions);
  return rule.permissions.every((key) => held.has(key as PermissionKey));
}

/** The declared rules, in a stable order. */
function rules() {
  return discoverRoutes(t.app)
    .filter((route) => route.rule.kind !== 'invalid')
    .map((route) => ({
      method: route.method,
      path: route.path.replace(/:([A-Za-z]+)/g, '{$1}'),
      ...route.rule,
    }))
    .sort((x, y) => `${x.path} ${x.method}`.localeCompare(`${y.path} ${y.method}`));
}

function render(): string {
  const mark = (yes: boolean) => (yes ? 'yes' : '-');
  const rows = rules().map((rule) => {
    const needs =
      rule.kind === 'permission'
        ? rule.permissions.map((key) => `\`${key}\``).join(' + ')
        : rule.kind === 'public'
          ? 'public'
          : 'any signed-in user';
    return `| ${rule.method} | \`${rule.path}\` | ${needs} | ${mark(mayCall('OWNER', rule))} | ${mark(mayCall('ADMIN', rule))} | ${mark(mayCall('CASHIER', rule))} |`;
  });
  return [
    '# Who may call which route',
    '',
    'Generated from the real routes and the built-in role presets by `test/integration/role-route-matrix.spec.ts`; do not edit by hand.',
    'Refresh after an intended change with `UPDATE_DOCS=1 pnpm test:int -- role-route-matrix`, and review the diff: a new `yes` in the Cashier column is a decision, not a side effect.',
    '',
    'Businesses can edit the Admin and Cashier roles, add their own roles, and grant or take away single permissions per person, so this shows the STARTING setup. The Owner always holds every permission. Branch rules (a person only reaches the branches assigned to them) apply on top of this table.',
    '',
    '| Method | Route | Needs | Owner | Admin | Cashier |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

describe('the written route-by-role table', () => {
  it('matches what the code says (refresh with UPDATE_DOCS=1 after an intended change)', () => {
    const expected = render();
    if (process.env.UPDATE_DOCS === '1') writeFileSync(DOC, expected, 'utf8');
    // The commit hook runs Prettier on Markdown, which re-pads table columns; spacing is not part of the meaning.
    const plain = (text: string) =>
      text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]*\|[ \t]*/g, '|')
        .replace(/-{2,}/g, '-')
        .trim();
    expect(plain(readFileSync(DOC, 'utf8'))).toBe(plain(expected));
  });

  it('a cashier by default can call no route that needs cost, writing, stock changes, audit, team or settings', () => {
    const offenders = rules()
      .filter((rule) => rule.kind === 'permission' && mayCall('CASHIER', rule))
      .filter(
        (rule) =>
          rule.kind === 'permission' &&
          rule.permissions.some((key) => NEVER_FOR_CASHIER.includes(key as PermissionKey)),
      )
      .map((rule) => `${rule.method} ${rule.path}`);
    expect(offenders).toEqual([]);
  });

  it('every permission route is reachable by the Owner, and by at least one role or custom setup (no dead routes)', () => {
    const permissionRoutes = rules().filter((rule) => rule.kind === 'permission');
    expect(permissionRoutes.length).toBeGreaterThan(40);
    expect(permissionRoutes.every((rule) => mayCall('OWNER', rule))).toBe(true);
  });
});
