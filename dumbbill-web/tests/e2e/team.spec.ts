import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MockApi, SAMPLE_ACCESS, SAMPLE_TENANT, SAMPLE_USER, signIn } from './support/mock-api';

/**
 * The team screens (people and roles) as a person meets them, in a real browser against a pretend API
 * (support/mock-api.ts). What the real server does (nobody grants what they do not hold, nobody edits the owner or
 * themselves, seats, immediate effect) is proven by the backend's own tests; here the question is: does each SCREEN say the
 * right words, send the right request (extras and taken-away computed against the role), show the server's refusal in
 * plain words, and hide what the person cannot use.
 */

const THEMES = ['dark', 'light'] as const;

const PERMISSIONS = [
  {
    key: 'products.read',
    group: 'Products',
    label: 'See products',
    description: 'Look up products and prices.',
    confidential: false,
  },
  {
    key: 'products.cost.read',
    group: 'Products',
    label: 'See purchase cost',
    description: 'See what products cost to buy.',
    confidential: true,
  },
  {
    key: 'pos.sell',
    group: 'Selling',
    label: 'Sell at the till',
    description: 'Make bills at the till.',
    confidential: false,
  },
  {
    key: 'discount.apply',
    group: 'Selling',
    label: 'Give discounts',
    description: 'Give a discount up to their limit.',
    confidential: false,
  },
  {
    key: 'stock.adjust',
    group: 'Stock',
    label: 'Change stock',
    description: 'Count stock and write off goods.',
    confidential: false,
  },
];

const OWNER_ROLE = {
  id: 'role-owner',
  name: 'Owner',
  description: 'The person who runs the business. Always has every permission.',
  systemKey: 'OWNER',
  locked: true,
  permissions: [],
  discountLimitBp: 10_000,
  allBranches: true,
  memberCount: 1,
};
const ADMIN_ROLE = {
  id: 'role-admin',
  name: 'Admin',
  description: 'Manages stock, prices, reports and the team.',
  systemKey: 'ADMIN',
  locked: false,
  permissions: [
    'products.read',
    'products.cost.read',
    'pos.sell',
    'discount.apply',
    'stock.adjust',
  ],
  discountLimitBp: 2_000,
  allBranches: true,
  memberCount: 0,
};
const CASHIER_ROLE = {
  id: 'role-cashier',
  name: 'Cashier',
  description: 'Sells at the till. Never sees purchase cost or profit.',
  systemKey: 'CASHIER',
  locked: false,
  permissions: ['products.read', 'pos.sell', 'discount.apply'],
  discountLimitBp: 500,
  allBranches: false,
  memberCount: 2,
};
const KEEPER_ROLE = {
  id: 'role-keeper',
  name: 'Stock keeper',
  description: 'Receives goods and counts stock.',
  systemKey: null,
  locked: false,
  permissions: ['products.read', 'stock.adjust'],
  discountLimitBp: 0,
  allBranches: false,
  memberCount: 0,
};

const MAIN = { id: 'br-main', name: 'Main branch' };
const BANER = { id: 'br-baner', name: 'Baner shop' };

const OPTIONS = {
  roles: [OWNER_ROLE, ADMIN_ROLE, CASHIER_ROLE, KEEPER_ROLE],
  branches: [MAIN, BANER],
  permissions: PERMISSIONS,
  seats: { max: 5, used: 3 },
};

function member(overrides: Record<string, unknown>) {
  return {
    id: 'm-x',
    email: 'x@fitfuel.in',
    fullName: 'Someone',
    status: 'ACTIVE',
    isOwner: false,
    role: { id: CASHIER_ROLE.id, name: 'Cashier' },
    branchIds: [MAIN.id],
    extraPermissions: [],
    deniedPermissions: [],
    discountLimitBp: null,
    effective: {
      permissions: CASHIER_ROLE.permissions,
      discountLimitBp: 500,
      allBranches: false,
    },
    hasPin: false,
    totpEnabled: false,
    lastLoginAt: '2026-10-18T09:30:00.000Z',
    createdAt: '2026-10-01T09:30:00.000Z',
    ...overrides,
  };
}
const RAVI = member({
  id: SAMPLE_USER.id,
  email: SAMPLE_USER.email,
  fullName: 'Ravi Mehta',
  isOwner: true,
  role: { id: OWNER_ROLE.id, name: 'Owner' },
  branchIds: [],
  effective: {
    permissions: PERMISSIONS.map((p) => p.key),
    discountLimitBp: 10_000,
    allBranches: true,
  },
});
const ASHA = member({ id: 'm-asha', email: 'asha@fitfuel.in', fullName: 'Asha Patil' });
const KARAN = member({
  id: 'm-karan',
  email: 'karan@fitfuel.in',
  fullName: 'Karan Shah',
  status: 'INVITED',
  lastLoginAt: null,
});
const MEERA = member({
  id: 'm-meera',
  email: 'meera@fitfuel.in',
  fullName: 'Meera Joshi',
  status: 'DISABLED',
});

function bodyOf(api: MockApi, key: string): Record<string, unknown> {
  return (api.last(key)?.body ?? {}) as Record<string, unknown>;
}
function alertOf(page: Page) {
  return page.locator('main#main').getByRole('alert');
}

/** Sign in (as the owner unless `access` says otherwise) and answer the calls the team screens make. */
async function start(page: Page, context: BrowserContext, access?: typeof SAMPLE_ACCESS) {
  const api = await signIn(page, context);
  if (access) {
    api.on('GET /v1/auth/me', {
      json: { user: { ...SAMPLE_USER, isOwner: false }, tenant: SAMPLE_TENANT, access },
    });
  }
  api.on('GET /v1/team/options', { json: OPTIONS });
  api.on('GET /v1/team/members', { json: { members: [RAVI, ASHA, KARAN, MEERA] } });
  return api;
}

test.describe('people', () => {
  test('lists the team with roles, branches and status, and marks the signed-in person', async ({
    page,
    context,
  }) => {
    await start(page, context);
    await page.goto('/team');
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
    await expect(page.getByText('3 of 5 places used')).toBeVisible();
    const table = page.getByRole('table', { name: 'People in your business' });
    const asha = table.getByRole('row', { name: /Asha Patil/ });
    await expect(asha).toContainText('Cashier');
    await expect(asha).toContainText('Main branch');
    await expect(table.getByRole('row', { name: /Karan Shah/ })).toContainText('Invited');
    await expect(table.getByRole('row', { name: /Meera Joshi/ })).toContainText('Switched off');
    await expect(table.getByRole('row', { name: /Ravi Mehta/ })).toContainText('You');
    // The owner and yourself have no action buttons: the server would refuse both.
    await expect(table.getByRole('row', { name: /Ravi Mehta/ }).getByRole('button')).toHaveCount(0);
  });

  test('invites a person: the role decides the starting abilities and only the difference is sent', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('POST /v1/team/members', (call) => ({
      status: 201,
      json: member({
        id: 'm-new',
        email: (call.body as { email: string }).email,
        status: 'INVITED',
      }),
    }));
    await page.goto('/team');
    await page.getByRole('button', { name: 'Invite a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a person' });

    // Nothing is sent until the form is valid.
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByText('Enter a name of at least 2 letters.')).toBeVisible();
    await expect(dialog.getByText('Enter an e-mail address.')).toBeVisible();
    await expect(dialog.getByText('Choose a role.')).toBeVisible();
    expect(api.count('POST /v1/team/members')).toBe(0);

    await dialog.getByLabel('Full name').fill('Dev Kulkarni');
    await dialog.getByLabel('E-mail address').fill('Dev@FitFuel.in');
    await dialog.getByRole('combobox', { name: /Role/ }).click();
    await page.getByRole('option', { name: 'Cashier' }).click();

    // A cashier works in assigned branches only, so the branch list appears (and warns while empty).
    await expect(dialog.getByText(/No branch ticked/)).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Baner shop' }).click();
    await expect(dialog.getByText(/No branch ticked/)).toHaveCount(0);

    // The abilities start from the role: take one away, add one extra.
    await expect(dialog.getByRole('checkbox', { name: /Sell at the till/ })).toBeChecked();
    await dialog.getByRole('checkbox', { name: /Give discounts/ }).click();
    await dialog.getByRole('checkbox', { name: /Change stock/ }).click();
    await dialog.getByLabel('Discount limit (%)').fill('2.5');

    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(
      page.getByText('Invitation sent to dev@fitfuel.in.', { exact: true }),
    ).toBeVisible();
    expect(bodyOf(api, 'POST /v1/team/members')).toEqual({
      email: 'dev@fitfuel.in',
      fullName: 'Dev Kulkarni',
      roleId: 'role-cashier',
      branchIds: ['br-baner'],
      extraPermissions: ['stock.adjust'],
      deniedPermissions: ['discount.apply'],
      discountLimitBp: 250,
    });
  });

  test('marks abilities that reveal cost, and shows the role they come from', async ({
    page,
    context,
  }) => {
    await start(page, context);
    await page.goto('/team');
    await page.getByRole('button', { name: 'Invite a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a person' });
    await dialog.getByRole('combobox', { name: /Role/ }).click();
    await page.getByRole('option', { name: 'Admin' }).click();
    await expect(dialog.getByText(/Shows what things cost or earn/)).toBeVisible();
    await expect(dialog.getByText('from the role').first()).toBeVisible();
  });

  test("shows the server's reason in plain words when it refuses a hand-out", async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('POST /v1/team/members', {
      problem: 'FORBIDDEN',
      status: 403,
      problemExtra: {
        detail: 'You can only grant permissions you hold yourself. Missing: products.cost.read.',
      },
    });
    await page.goto('/team');
    await page.getByRole('button', { name: 'Invite a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a person' });
    await dialog.getByLabel('Full name').fill('Dev Kulkarni');
    await dialog.getByLabel('E-mail address').fill('dev@fitfuel.in');
    await dialog.getByRole('combobox', { name: /Role/ }).click();
    await page.getByRole('option', { name: 'Admin' }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'Missing: products.cost.read.' }),
    ).toBeVisible();
  });

  test('edits a person: the e-mail is fixed and a new role starts the abilities again', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('PATCH /v1/team/members/m-asha', { json: { ...ASHA, fullName: 'Asha P. Patil' } });
    await page.goto('/team');
    await page.getByRole('button', { name: 'Edit Asha Patil' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Asha Patil' });
    await expect(dialog.getByLabel('E-mail address')).toHaveAttribute('readonly', '');
    await dialog.getByLabel('Full name').fill('Asha P. Patil');
    await dialog.getByRole('combobox', { name: /Role/ }).click();
    await page.getByRole('option', { name: 'Stock keeper' }).click();
    // Stock keeper gives products.read + stock.adjust; the cashier abilities are gone.
    await expect(dialog.getByRole('checkbox', { name: /Change stock/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Sell at the till/ })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
    expect(bodyOf(api, 'PATCH /v1/team/members/m-asha')).toMatchObject({
      fullName: 'Asha P. Patil',
      roleId: 'role-keeper',
      branchIds: ['br-main'],
      extraPermissions: [],
      deniedPermissions: [],
      discountLimitBp: null,
    });
  });

  test('switching someone off asks first; switching on and resending an invitation do not', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('POST /v1/team/members/m-asha/disable', { json: { ...ASHA, status: 'DISABLED' } });
    api.on('POST /v1/team/members/m-meera/enable', { json: { ...MEERA, status: 'ACTIVE' } });
    api.on('POST /v1/team/members/m-karan/resend-invitation', { status: 204 });
    await page.goto('/team');

    await page.getByRole('button', { name: 'Switch off Asha Patil' }).click();
    const confirm = page.getByRole('dialog', { name: 'Switch off Asha Patil?' });
    await expect(confirm.getByText(/signed out at once/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep them on' }).click();
    expect(api.count('POST /v1/team/members/m-asha/disable')).toBe(0);

    await page.getByRole('button', { name: 'Switch off Asha Patil' }).click();
    await page
      .getByRole('dialog', { name: 'Switch off Asha Patil?' })
      .getByRole('button', { name: 'Switch off' })
      .click();
    await expect(
      page.getByText('Asha Patil is switched off and signed out.', { exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Switch on Meera Joshi' }).click();
    await expect(page.getByText('Meera Joshi is switched on.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Send invitation again to Karan Shah' }).click();
    await expect(
      page.getByText('A new invitation is on its way to Karan Shah.', { exact: true }),
    ).toBeVisible();
  });

  test('says when every place on the plan is used', async ({ page, context }) => {
    const api = await start(page, context);
    api.on('GET /v1/team/options', { json: { ...OPTIONS, seats: { max: 3, used: 3 } } });
    await page.goto('/team');
    await expect(
      alertOf(page).filter({ hasText: 'All places on your plan are used.' }),
    ).toBeVisible();
  });
});

test.describe('roles', () => {
  test('lists built-in and own roles; the Owner role cannot be changed, built-in ones cannot be deleted', async ({
    page,
    context,
  }) => {
    await start(page, context);
    await page.goto('/team');
    await page.getByRole('tab', { name: 'Roles' }).click();
    const table = page.getByRole('table', { name: 'Roles in your business' });
    await expect(table.getByRole('row', { name: /Owner/ })).toContainText('Everything');
    await expect(table.getByRole('row', { name: /Owner/ }).getByRole('button')).toHaveCount(0);
    await expect(table.getByRole('row', { name: /Cashier/ })).toContainText('3 abilities');
    await expect(table.getByRole('row', { name: /Cashier/ })).toContainText('5%');
    await expect(page.getByRole('button', { name: 'Edit the Cashier role' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete the Cashier role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete the Stock keeper role' })).toBeVisible();
  });

  test('adds a role with its abilities, discount limit and branch rule', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('POST /v1/team/roles', {
      status: 201,
      json: { ...KEEPER_ROLE, id: 'role-new', name: 'Counter lead' },
    });
    await page.goto('/team');
    await page.getByRole('tab', { name: 'Roles' }).click();
    await page.getByRole('button', { name: 'Add a role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a role' });
    await dialog.getByLabel('Role name').fill('Counter lead');
    await dialog.getByLabel('Discount limit (%)').fill('10');
    await dialog.getByRole('checkbox', { name: 'Works in every branch' }).click();
    await dialog.getByRole('checkbox', { name: /Sell at the till/ }).click();
    await dialog.getByRole('checkbox', { name: /Give discounts/ }).click();
    await dialog.getByRole('button', { name: 'Add role' }).click();
    await expect(page.getByText('Role added.', { exact: true })).toBeVisible();
    expect(bodyOf(api, 'POST /v1/team/roles')).toEqual({
      name: 'Counter lead',
      description: '',
      permissions: ['discount.apply', 'pos.sell'],
      discountLimitBp: 1000,
      allBranches: true,
    });
  });

  test('a built-in role keeps its name when edited', async ({ page, context }) => {
    const api = await start(page, context);
    api.on('PATCH /v1/team/roles/role-cashier', { json: CASHIER_ROLE });
    await page.goto('/team');
    await page.getByRole('tab', { name: 'Roles' }).click();
    await page.getByRole('button', { name: 'Edit the Cashier role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit the Cashier role' });
    await expect(dialog.getByLabel('Role name')).toHaveAttribute('readonly', '');
    await dialog.getByRole('checkbox', { name: /Give discounts/ }).click();
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Role saved.', { exact: true })).toBeVisible();
    const body = bodyOf(api, 'PATCH /v1/team/roles/role-cashier');
    expect(body).not.toHaveProperty('name');
    expect(body).toMatchObject({ permissions: ['pos.sell', 'products.read'] });
  });

  test('deleting asks first, and shows the number of people when the server refuses', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('DELETE /v1/team/roles/role-keeper', {
      problem: 'CONFLICT',
      problemExtra: { detail: '2 people still have this role. Move them to another role first.' },
    });
    await page.goto('/team');
    await page.getByRole('tab', { name: 'Roles' }).click();
    await page.getByRole('button', { name: 'Delete the Stock keeper role' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete the Stock keeper role?' });
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    expect(api.count('DELETE /v1/team/roles/role-keeper')).toBe(0);

    await page.getByRole('button', { name: 'Delete the Stock keeper role' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete role' }).click();
    await expect(alertOf(page).filter({ hasText: '2 people still have this role.' })).toBeVisible();
  });
});

test.describe('who can open it', () => {
  test('a person without team.manage has no menu link and is told they cannot open the page', async ({
    page,
    context,
  }) => {
    const api = await start(page, context, {
      ...SAMPLE_ACCESS,
      permissions: ['products.read', 'pos.sell'],
      allBranches: false,
    });
    api.on('GET /v1/team/options', { problem: 'FORBIDDEN' });
    api.on('GET /v1/team/members', { problem: 'FORBIDDEN' });
    await page.goto('/team');
    await expect(
      alertOf(page).filter({ hasText: 'You do not have permission to do that.' }),
    ).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
  });

  test('the owner sees the Team link', async ({ page, context }) => {
    await start(page, context);
    await page.goto('/team');
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Team' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

for (const theme of THEMES) {
  for (const tab of ['People', 'Roles'] as const) {
    test(`team ${tab.toLowerCase()} is accessible in the ${theme} theme`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'dumbbill-theme', value: theme, url: baseURL! }]);
      await start(page, context);
      await page.goto('/team');
      await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
      if (tab === 'Roles') await page.getByRole('tab', { name: 'Roles' }).click();
      await expect(page.locator('main#main [role="status"][aria-label^="Loading"]')).toHaveCount(0);
      await page.screenshot({
        path: `test-results/screens/team-${tab.toLowerCase()}-${theme}.png`,
        fullPage: true,
      });
      const open = tab === 'People' ? 'Invite a person' : 'Add a role';
      for (const withDialog of [false, true]) {
        if (withDialog) await page.getByRole('button', { name: open }).click();
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          result.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map(
              (v) =>
                `${v.id}: ${v.help} -> ${v.nodes
                  .map((n) => n.target.join(' '))
                  .slice(0, 3)
                  .join(' | ')}`,
            ),
        ).toEqual([]);
      }
    });
  }
}
