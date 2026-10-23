import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MockApi, SAMPLE_ACCESS, SAMPLE_TENANT, SAMPLE_USER, signIn } from './support/mock-api';

/**
 * The business profile, branch and first-steps screens as a person meets them, in a real browser against a pretend
 * API (support/mock-api.ts). What the real server does (GSTIN check character, plan limits, tenant isolation) is proven
 * by the backend's own tests; here the question is: does each SCREEN say the right words, send the right request,
 * and put server messages next to the right box.
 */

const THEMES = ['dark', 'light'] as const;

const PROFILE = {
  name: 'FitFuel Nutrition',
  gstin: null,
  stateCode: '27',
  stateName: 'Maharashtra',
  addressLine: '12, Ganesh Peth, Near Shaniwar Wada',
  city: 'Pune',
  pincode: '411002',
  phone: '+919822012345',
  hasLogo: false,
};

const STATES = {
  states: [
    { code: '29', name: 'Karnataka', isUnionTerritory: false },
    { code: '27', name: 'Maharashtra', isUnionTerritory: false },
    { code: '07', name: 'Delhi', isUnionTerritory: true },
  ],
};

const KOTHRUD = {
  id: '0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b',
  name: 'Kothrud shop',
  isActive: true,
  invoicePrefix: 'KOT',
  printerWidthMm: 80,
  stateCode: '27',
  stateName: 'Maharashtra',
  gstin: null,
  addressLine: '45, Paud Road',
  city: 'Pune',
  pincode: '411038',
  phone: null,
};
const BANER = {
  ...KOTHRUD,
  id: '0192a3b4-0002-7e8f-9a0b-1c2d3e4f5a6b',
  name: 'Baner shop',
  invoicePrefix: 'BAN',
  printerWidthMm: 58,
  isActive: false,
  city: 'Pune',
};

/** The control whose label is exactly `label` (a required field adds a decorative star). */
function field(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByLabel(new RegExp(`^${escaped}\\s*\\*?$`));
}

/** Next.js keeps an invisible `role="alert"` route announcer on every page, so look inside the main area. */
function alertOf(page: Page) {
  return page.locator('main#main').getByRole('alert');
}

function bodyOf(api: MockApi, key: string): Record<string, unknown> {
  return (api.last(key)?.body ?? {}) as Record<string, unknown>;
}

async function pickState(page: Page, name: string) {
  await field(page, 'State').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

/** Sign in as the sample owner and answer the calls the profile screen makes. */
async function openProfile(page: Page, context: Parameters<typeof signIn>[1]) {
  const api = await signIn(page, context);
  api.on('GET /v1/business', { json: PROFILE });
  api.on('GET /v1/business/gst-states', { json: STATES });
  api.on('GET /v1/business/logo', { problem: 'NOT_FOUND' });
  await page.goto('/settings/business');
  await expect(page.getByRole('heading', { level: 1, name: 'Business profile' })).toBeVisible();
  await expect(field(page, 'Business name')).toHaveValue('FitFuel Nutrition');
  return api;
}

test.describe('the business profile', () => {
  test('shows the saved details and warns that no GSTIN means bills of supply only', async ({
    page,
    context,
  }) => {
    await openProfile(page, context);
    await expect(field(page, 'City')).toHaveValue('Pune');
    await expect(field(page, 'State')).toHaveText(/Maharashtra/);
    await expect(page.getByText('No GSTIN on file')).toBeVisible();
    await expect(page.getByText(/only bills of supply/)).toBeVisible();
  });

  test('saves a cleaned-up GSTIN and sends blank optional fields as null', async ({
    page,
    context,
  }) => {
    const api = await openProfile(page, context);
    api.on('PUT /v1/business', (call) => ({
      json: { ...PROFILE, ...(call.body as object) },
    }));
    await field(page, 'GSTIN').fill('27 aapfu 0939 f1zv');
    await field(page, 'Phone').fill('');
    await page.getByRole('button', { name: 'Save details' }).click();

    await expect(page.getByText('Business details saved.', { exact: true })).toBeVisible();
    expect(bodyOf(api, 'PUT /v1/business')).toMatchObject({
      name: 'FitFuel Nutrition',
      stateCode: '27',
      gstin: '27AAPFU0939F1ZV',
      phone: null,
    });
    // The warning goes away once a GSTIN is typed.
    await expect(page.getByText('No GSTIN on file')).toHaveCount(0);
  });

  test('refuses a GSTIN of the wrong shape in the browser, before any request is made', async ({
    page,
    context,
  }) => {
    const api = await openProfile(page, context);
    await field(page, 'GSTIN').fill('NOT-A-GSTIN');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(alertOf(page).filter({ hasText: /15 letters and digits/ })).toBeVisible();
    expect(api.count('PUT /v1/business')).toBe(0);
  });

  test("shows the server's check-character message under the GSTIN box", async ({
    page,
    context,
  }) => {
    const api = await openProfile(page, context);
    api.on('PUT /v1/business', {
      problem: 'VALIDATION_FAILED',
      problemExtra: {
        errors: [
          {
            field: 'gstin',
            message:
              'This GSTIN has a typing mistake: its last character does not match the others.',
          },
        ],
      },
    });
    await field(page, 'GSTIN').fill('27AAPFU0939F1ZW');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(alertOf(page).filter({ hasText: /typing mistake/ })).toBeVisible();
    await expect(field(page, 'GSTIN')).toHaveAttribute('aria-invalid', 'true');
  });

  test('is read-only for someone without settings.manage', async ({ page, context }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/auth/me', {
      json: {
        user: { ...SAMPLE_USER, isOwner: false },
        tenant: SAMPLE_TENANT,
        access: { ...SAMPLE_ACCESS, roleName: 'Cashier', permissions: ['pos.sell'] },
      },
    });
    api.on('GET /v1/business', { json: PROFILE });
    api.on('GET /v1/business/gst-states', { json: STATES });
    await page.goto('/settings/business');
    await expect(page.getByText(/only the owner can change them/)).toBeVisible();
    await expect(field(page, 'Business name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save details' })).toHaveCount(0);
  });

  test('uploads a logo as a multipart file, and refuses a wrong type without asking the server', async ({
    page,
    context,
  }) => {
    const api = await openProfile(page, context);
    api.on('PUT /v1/business/logo', { json: { ...PROFILE, hasLogo: true } });

    await page.getByTestId('logo-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(alertOf(page).filter({ hasText: /PNG, JPEG or WebP image/ })).toBeVisible();
    expect(api.count('PUT /v1/business/logo')).toBe(0);

    await page.getByTestId('logo-input').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    await expect(page.getByText('Logo saved.', { exact: true })).toBeVisible();
    expect(api.last('PUT /v1/business/logo')?.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=/,
    );
  });
});

/** Answer the branch calls with Kothrud (active) and Baner (switched off), a limit of 3 and 1 used. */
async function openBranches(page: Page, context: Parameters<typeof signIn>[1], used = 1, max = 3) {
  const api = await signIn(page, context);
  api.on('GET /v1/branches', { json: { branches: [KOTHRUD, BANER], limit: { max, used } } });
  api.on('GET /v1/business/gst-states', { json: STATES });
  await page.goto('/branches');
  await expect(page.getByRole('heading', { level: 1, name: 'Branches' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Kothrud shop/ })).toBeVisible();
  return api;
}

test.describe('branches', () => {
  test('lists branches with prefix, state, paper width and status, and shows plan usage', async ({
    page,
    context,
  }) => {
    await openBranches(page, context);
    await expect(page.getByText('1 of 3 branches in use on your plan')).toBeVisible();
    const kothrud = page.getByRole('row', { name: /Kothrud shop/ });
    await expect(kothrud).toContainText('KOT');
    await expect(kothrud).toContainText('Maharashtra');
    await expect(kothrud).toContainText('80 mm');
    await expect(kothrud).toContainText('Active');
    await expect(page.getByRole('row', { name: /Baner shop/ })).toContainText('Switched off');
    await expect(page.getByRole('link', { name: 'Add a branch' })).toBeVisible();
  });

  test('at the plan limit, replaces "Add a branch" with a plain explanation', async ({
    page,
    context,
  }) => {
    await openBranches(page, context, 3, 3);
    await expect(page.getByRole('link', { name: 'Add a branch' })).toHaveCount(0);
    await expect(alertOf(page).filter({ hasText: 'Your plan is full' })).toBeVisible();
    await expect(page.getByText(/allows 3 branches and all are in use/)).toBeVisible();
  });

  test('asks before switching a branch off, then sends the request', async ({ page, context }) => {
    const api = await openBranches(page, context);
    api.on('POST /v1/branches/0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b/deactivate', {
      json: { ...KOTHRUD, isActive: false },
    });
    await page.getByRole('button', { name: 'Switch off Kothrud shop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Switch off Kothrud shop?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep it on' }).click();
    expect(api.count('POST /v1/branches/0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b/deactivate')).toBe(0);

    await page.getByRole('button', { name: 'Switch off Kothrud shop' }).click();
    await dialog.getByRole('button', { name: 'Switch off', exact: true }).click();
    await expect(page.getByText('Branch switched off.', { exact: true })).toBeVisible();
    expect(api.count('POST /v1/branches/0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b/deactivate')).toBe(1);
  });

  test('explains why the last active branch cannot be switched off', async ({ page, context }) => {
    const api = await openBranches(page, context);
    api.on('POST /v1/branches/0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b/deactivate', {
      problem: 'BUSINESS_RULE_VIOLATION',
      status: 422,
    });
    await page.getByRole('button', { name: 'Switch off Kothrud shop' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Switch off', exact: true }).click();
    await expect(alertOf(page).filter({ hasText: /only active branch/ })).toBeVisible();
  });

  test('switches a branch back on', async ({ page, context }) => {
    const api = await openBranches(page, context);
    api.on('POST /v1/branches/0192a3b4-0002-7e8f-9a0b-1c2d3e4f5a6b/activate', {
      json: { ...BANER, isActive: true },
    });
    await page.getByRole('button', { name: 'Switch on Baner shop' }).click();
    await expect(page.getByText('Branch switched on.', { exact: true })).toBeVisible();
  });

  test('creates a branch and sends the prefix in capitals and paper width as a number', async ({
    page,
    context,
  }) => {
    const api = await openBranches(page, context);
    api.on('POST /v1/branches', (call) => ({
      status: 201,
      json: { ...KOTHRUD, id: 'new-id', ...(call.body as object) },
    }));
    await page.getByRole('link', { name: 'Add a branch' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Add a branch' })).toBeVisible();

    await field(page, 'Branch name').fill('Baner road');
    await field(page, 'Invoice prefix').fill('ban 2');
    await pickState(page, 'Maharashtra');
    await page.getByRole('button', { name: 'Add branch' }).click();

    await expect(page).toHaveURL(/\/branches$/);
    expect(bodyOf(api, 'POST /v1/branches')).toMatchObject({
      name: 'Baner road',
      invoicePrefix: 'BAN2',
      printerWidthMm: 80,
      stateCode: '27',
      gstin: null,
      phone: null,
    });
  });

  test('shows "prefix already used" next to the prefix box', async ({ page, context }) => {
    const api = await openBranches(page, context);
    api.on('POST /v1/branches', {
      problem: 'CONFLICT',
      problemExtra: {
        errors: [{ field: 'invoicePrefix', message: 'Another branch already uses this prefix.' }],
      },
    });
    await page.goto('/branches/new');
    await field(page, 'Branch name').fill('Baner road');
    await field(page, 'Invoice prefix').fill('KOT');
    await pickState(page, 'Maharashtra');
    await page.getByRole('button', { name: 'Add branch' }).click();
    await expect(alertOf(page).filter({ hasText: /already uses this prefix/ })).toBeVisible();
    await expect(field(page, 'Invoice prefix')).toHaveAttribute('aria-invalid', 'true');
  });

  test('explains the plan limit when the server refuses a new branch', async ({
    page,
    context,
  }) => {
    const api = await openBranches(page, context);
    api.on('POST /v1/branches', {
      problem: 'PLAN_LIMIT_REACHED',
      status: 422,
      problemExtra: { detail: 'Your plan allows 1 branch and all are in use.' },
    });
    await page.goto('/branches/new');
    await field(page, 'Branch name').fill('Baner road');
    await field(page, 'Invoice prefix').fill('BAN');
    await pickState(page, 'Maharashtra');
    await page.getByRole('button', { name: 'Add branch' }).click();
    await expect(alertOf(page).filter({ hasText: 'Your plan is full' })).toBeVisible();
  });

  test('edits an existing branch with its values filled in', async ({ page, context }) => {
    const api = await openBranches(page, context);
    api.on('GET /v1/branches/0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b', { json: KOTHRUD });
    api.on('PUT /v1/branches/0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b', (call) => ({
      json: { ...KOTHRUD, ...(call.body as object) },
    }));
    await page.getByRole('link', { name: 'Edit Kothrud shop' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit branch' })).toBeVisible();
    await expect(field(page, 'Branch name')).toHaveValue('Kothrud shop');
    await expect(field(page, 'Invoice prefix')).toHaveValue('KOT');
    await field(page, 'City').fill('Pune West');
    await page.getByRole('button', { name: 'Save branch' }).click();
    await expect(page).toHaveURL(/\/branches$/);
    expect(bodyOf(api, 'PUT /v1/branches/0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b')).toMatchObject({
      city: 'Pune West',
      invoicePrefix: 'KOT',
    });
  });

  test("says so when a branch does not exist or is not the person's to use", async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/business/gst-states', { json: STATES });
    api.on('GET /v1/branches/0192a3b4-9999-7e8f-9a0b-1c2d3e4f5a6b', { problem: 'NOT_FOUND' });
    await page.goto('/branches/0192a3b4-9999-7e8f-9a0b-1c2d3e4f5a6b');
    await expect(
      alertOf(page).filter({ hasText: /does not exist, or you cannot use it/ }),
    ).toBeVisible();
  });

  test('a cashier sees only their branches and no buttons to change anything', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/auth/me', {
      json: {
        user: { ...SAMPLE_USER, isOwner: false },
        tenant: SAMPLE_TENANT,
        access: {
          ...SAMPLE_ACCESS,
          roleName: 'Cashier',
          permissions: ['pos.sell'],
          allBranches: false,
          branchIds: [KOTHRUD.id],
        },
      },
    });
    api.on('GET /v1/branches', { json: { branches: [KOTHRUD], limit: { max: 3, used: 2 } } });
    await page.goto('/branches');
    await expect(page.getByRole('cell', { name: /^Kothrud shop/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add a branch' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Switch off/ })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
  });
});

test.describe('the first-steps checklist on the home screen', () => {
  test('lists the steps, links to where each is done, and counts progress', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/business/onboarding', {
      json: {
        steps: [
          { key: 'PROFILE', done: true },
          { key: 'BRANCH', done: false },
          { key: 'TEAM', done: false },
        ],
        gstinMissing: true,
      },
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2, name: 'Set up your shop' })).toBeVisible();
    await expect(page.getByText('1 of 3 done')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Set up the branch' })).toHaveAttribute(
      'href',
      '/branches',
    );
    // The profile step is done, so it offers no button; the team step now links to the team screen.
    await expect(page.getByRole('link', { name: 'Fill in the profile' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Invite someone' })).toHaveAttribute(
      'href',
      '/team',
    );
  });

  test('shrinks to one line when everything is done', async ({ page, context }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/business/onboarding', {
      json: {
        steps: [
          { key: 'PROFILE', done: true },
          { key: 'BRANCH', done: true },
          { key: 'TEAM', done: true },
        ],
        gstinMissing: false,
      },
    });
    await page.goto('/');
    await expect(page.getByText('The basics are in place.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your shop' })).toHaveCount(0);
  });

  test('is not shown to people who cannot manage settings, and is not even requested', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/auth/me', {
      json: {
        user: { ...SAMPLE_USER, isOwner: false },
        tenant: SAMPLE_TENANT,
        access: { ...SAMPLE_ACCESS, roleName: 'Cashier', permissions: ['pos.sell'] },
      },
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your shop' })).toHaveCount(0);
    expect(api.count('GET /v1/business/onboarding')).toBe(0);
  });

  test('settings links appear in the menu only for people who can manage settings', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/business/onboarding', { json: { steps: [], gstinMissing: false } });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Business profile' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Branches' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

/** Every new screen, in both themes, must pass the automatic accessibility check. */
for (const theme of THEMES) {
  const screens = [
    {
      name: 'business profile',
      path: '/settings/business',
      heading: 'Business profile',
      prepare: (api: MockApi) => {
        api.on('GET /v1/business', { json: PROFILE });
        api.on('GET /v1/business/gst-states', { json: STATES });
        api.on('GET /v1/business/logo', { problem: 'NOT_FOUND' });
      },
    },
    {
      name: 'branches',
      path: '/branches',
      heading: 'Branches',
      prepare: (api: MockApi) => {
        api.on('GET /v1/branches', {
          json: { branches: [KOTHRUD, BANER], limit: { max: 3, used: 1 } },
        });
      },
    },
    {
      name: 'new branch',
      path: '/branches/new',
      heading: 'Add a branch',
      prepare: (api: MockApi) => api.on('GET /v1/business/gst-states', { json: STATES }),
    },
    {
      name: 'home with checklist',
      path: '/',
      heading: 'Owner dashboard',
      prepare: (api: MockApi) =>
        api.on('GET /v1/business/onboarding', {
          json: {
            steps: [
              { key: 'PROFILE', done: true },
              { key: 'BRANCH', done: false },
              { key: 'TEAM', done: false },
            ],
            gstinMissing: true,
          },
        }),
    },
  ];
  for (const screen of screens) {
    test(`${screen.name} is accessible in the ${theme} theme`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'dumbbill-theme', value: theme, url: baseURL! }]);
      const api = await signIn(page, context);
      screen.prepare(api);
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible();
      // Wait until the data has arrived, so the check sees the real screen and not its loading state.
      await expect(page.locator('main#main [role="status"][aria-label^="Loading"]')).toHaveCount(0);
      await page.screenshot({
        path: `test-results/screens/business-${screen.name.replace(/[^a-z]+/g, '-')}-${theme}.png`,
        fullPage: true,
      });
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
    });
  }
}
