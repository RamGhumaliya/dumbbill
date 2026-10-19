import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MockApi, SAMPLE_ACCESS, SAMPLE_TENANT, SAMPLE_USER, signIn } from './support/mock-api';

/**
 * The catalogue screens as a person meets them, in a real browser against a pretend API (support/mock-api.ts): the
 * products table (filters, column picker, keyboard price editing), the product form, the price dialog and history, the
 * picture upload and the CSV import. What the real server does (unique barcodes, price history, cost secrecy) is proven
 * by the backend's own tests; here the question is: does each SCREEN say the right words, send the right request, show
 * server messages next to the right box, and keep cost out of sight of people who may not see it.
 */

const THEMES = ['dark', 'light'] as const;

const WHEY = {
  id: '0192a3b4-0001-7e8f-9a0b-1c2d3e4f5a6b',
  name: 'Gold Standard 100% Whey',
  brand: 'Optimum Nutrition',
  variant: '2 kg / Chocolate',
  categoryId: 'cat-protein',
  categoryName: 'Protein & whey',
  sku: 'ON-GS-2KG-CHOC',
  barcode: '748927052145',
  hsn: '21069099',
  gstRateBp: 1800,
  mrpPaise: 349_900,
  pricePaise: 299_900,
  hasImage: false,
  isActive: true,
};
const CREATINE = {
  ...WHEY,
  id: '0192a3b4-0002-7e8f-9a0b-1c2d3e4f5a6b',
  name: 'Creatine Monohydrate',
  brand: 'MuscleBlaze',
  variant: '250 g',
  sku: 'MB-CR-250',
  barcode: '8904000111',
  mrpPaise: 129_900,
  pricePaise: 99_900,
};
/** What the admin shape adds (people with products.cost.read). */
const withCost = (product: typeof WHEY, cost: number) => ({
  ...product,
  purchaseCostPaise: cost,
  marginBp: Math.round(((product.pricePaise - cost) * 10_000) / product.pricePaise),
  belowCost: product.pricePaise < cost,
});

const OPTIONS = {
  categories: [
    { id: 'cat-protein', name: 'Protein & whey', defaultHsn: '21069099', defaultGstRateBp: 1800 },
    { id: 'cat-gear', name: 'Accessories & apparel', defaultHsn: '392330', defaultGstRateBp: 1800 },
  ],
  gstRatesBp: [0, 25, 300, 500, 1800, 4000],
  taxDetailsRequired: false,
};

const CASHIER_ACCESS = {
  ...SAMPLE_ACCESS,
  roleName: 'Cashier',
  permissions: ['products.read', 'pos.sell'],
};

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

async function pick(page: Page, label: string, option: string | RegExp) {
  await field(page, label).click();
  await page.getByRole('option', { name: option }).click();
}

/** Sign in with the given access and answer the catalogue list. */
async function openProducts(
  page: Page,
  context: BrowserContext,
  options: { access?: typeof SAMPLE_ACCESS; items?: object[]; total?: number } = {},
) {
  const api = await signIn(page, context);
  if (options.access) {
    api.on('GET /v1/auth/me', {
      json: {
        user: { ...SAMPLE_USER, isOwner: false },
        tenant: SAMPLE_TENANT,
        access: options.access,
      },
    });
  }
  const items = options.items ?? [withCost(WHEY, 240_000), withCost(CREATINE, 120_000)];
  api.on('GET /v1/products', (call) => ({
    json: {
      items,
      total: options.total ?? items.length,
      limit: 50,
      offset: Number(new URLSearchParams(call.search).get('offset') ?? 0),
    },
  }));
  api.on('GET /v1/products/options', { json: OPTIONS });
  await page.goto('/products');
  await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Gold Standard/ })).toBeVisible();
  return api;
}

test.describe('the products table', () => {
  test('shows name, variant, price, GST, and (for people with cost access) cost and margin', async ({
    page,
    context,
  }) => {
    await openProducts(page, context);
    const row = page.getByRole('row', { name: /Gold Standard/ });
    await expect(row).toContainText('Optimum Nutrition · 2 kg / Chocolate');
    await expect(row).toContainText('₹2,999.00');
    await expect(row).toContainText('₹3,499.00');
    await expect(row).toContainText('18%');
    await expect(row).toContainText('₹2,400.00');
    await expect(row).toContainText('20.0%');
    await expect(page.getByRole('columnheader', { name: 'Cost' })).toBeVisible();
  });

  test('has NO cost or margin column for a cashier, nothing to edit, and no buttons that change things', async ({
    page,
    context,
  }) => {
    await openProducts(page, context, { access: CASHIER_ACCESS, items: [WHEY, CREATINE] });
    await expect(page.getByRole('columnheader', { name: 'Cost' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Margin' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add a product' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import from CSV' })).toHaveCount(0);
    // The price is plain text, not a button to edit.
    await expect(page.getByRole('button', { name: /Change the price of/ })).toHaveCount(0);
    await expect(page.locator('main#main')).not.toContainText('₹2,400.00');
    // The column picker does not offer cost or margin either.
    await page.getByRole('button', { name: 'Columns' }).click();
    await expect(page.getByRole('checkbox', { name: 'Cost' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Margin' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'MRP' })).toBeVisible();
  });

  test('lets a person hide and show columns, and remembers the choice after a reload', async ({
    page,
    context,
  }) => {
    await openProducts(page, context);
    await expect(page.getByRole('columnheader', { name: 'SKU' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('checkbox', { name: 'SKU' }).click();
    await page.getByRole('checkbox', { name: 'MRP' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader', { name: 'SKU' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'MRP' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('columnheader', { name: 'SKU' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'MRP' })).toHaveCount(0);
  });

  test('sends the search, category, status and page the person chose', async ({
    page,
    context,
  }) => {
    const api = await openProducts(page, context, { total: 120 });
    await page.getByLabel('Search products').fill('whey');
    await expect.poll(() => api.last('GET /v1/products')?.search).toContain('q=whey');

    await pick(page, 'Category', 'Protein & whey');
    await expect
      .poll(() => api.last('GET /v1/products')?.search)
      .toContain('categoryId=cat-protein');
    await pick(page, 'Show', 'Switched-off products');
    await expect.poll(() => api.last('GET /v1/products')?.search).toContain('status=inactive');

    await expect(page.getByText('Showing 1-50 of 120')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => api.last('GET /v1/products')?.search).toContain('offset=50');
    await expect(page.getByText('Showing 51-100 of 120')).toBeVisible();
  });

  test('says so when nothing matches, or when there are no products at all', async ({
    page,
    context,
  }) => {
    await openProducts(page, context, { items: [withCost(WHEY, 1)] });
    const api = await signIn(page, context);
    api.on('GET /v1/products', { json: { items: [], total: 0, limit: 50, offset: 0 } });
    api.on('GET /v1/products/options', { json: OPTIONS });
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible();
    await page.getByLabel('Search products').fill('zzz');
    await expect(
      page.getByRole('heading', { name: 'No product matches these filters.' }),
    ).toBeVisible();
  });

  test('switches a product off and on', async ({ page, context }) => {
    const api = await openProducts(page, context);
    api.on(`POST /v1/products/${WHEY.id}/deactivate`, {
      json: withCost({ ...WHEY, isActive: false }, 240_000),
    });
    api.on(`POST /v1/products/${WHEY.id}/activate`, { json: withCost(WHEY, 240_000) });
    await page.getByRole('button', { name: 'Switch off Gold Standard 100% Whey' }).click();
    await expect(page.getByText('Product switched off.', { exact: true })).toBeVisible();
    expect(api.count(`POST /v1/products/${WHEY.id}/deactivate`)).toBe(1);
  });
});

test.describe('changing a price from the keyboard', () => {
  test('arrow keys move between rows, Enter edits, and the dialog asks WHY before anything is saved', async ({
    page,
    context,
  }) => {
    const api = await openProducts(page, context);
    api.on(`POST /v1/products/${WHEY.id}/prices`, {
      json: withCost({ ...WHEY, pricePaise: 279_900 }, 240_000),
    });

    const first = page.getByRole('button', {
      name: 'Change the price of Gold Standard 100% Whey. Press Enter to open the change form.',
    });
    const second = page.getByRole('button', { name: /Change the price of Creatine Monohydrate/ });
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();

    await page.keyboard.press('Enter');
    const box = page.getByRole('textbox', { name: /Change the price of Gold Standard/ });
    await expect(box).toHaveValue('2999');
    await box.fill('2799');
    await page.keyboard.press('Enter');

    // Nothing is saved yet: the dialog asks why.
    const dialog = page.getByRole('dialog', {
      name: 'Change the price of Gold Standard 100% Whey',
    });
    await expect(dialog).toBeVisible();
    expect(api.count(`POST /v1/products/${WHEY.id}/prices`)).toBe(0);
    await expect(dialog.getByLabel(/^New selling price/)).toHaveValue('2799');
    await dialog.getByLabel(/^Why is it changing/).fill('Diwali offer');
    await dialog.getByRole('button', { name: 'Save price' }).click();

    await expect(page.getByText('Price changed.', { exact: true })).toBeVisible();
    expect(bodyOf(api, `POST /v1/products/${WHEY.id}/prices`)).toEqual({
      mrpPaise: 349_900,
      pricePaise: 279_900,
      reason: 'Diwali offer',
    });
  });

  test('Escape cancels the edit without opening anything, and a price above the MRP is not even proposed', async ({
    page,
    context,
  }) => {
    const api = await openProducts(page, context);
    const first = page.getByRole('button', { name: /Change the price of Gold Standard/ });
    await first.click();
    const box = page.getByRole('textbox', { name: /Change the price of Gold Standard/ });
    await box.fill('1');
    await page.keyboard.press('Escape');
    await expect(first).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await first.click();
    await page.getByRole('textbox', { name: /Change the price of Gold Standard/ }).fill('9999');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.count(`POST /v1/products/${WHEY.id}/prices`)).toBe(0);
  });

  test("refuses a missing reason in the browser and shows the server's answers next to the right boxes", async ({
    page,
    context,
  }) => {
    const api = await openProducts(page, context);
    await page.getByRole('button', { name: /Change the price of Gold Standard/ }).click();
    await page.getByRole('textbox', { name: /Change the price of Gold Standard/ }).fill('2500');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save price' }).click();
    await expect(
      alertOf(page)
        .or(dialog.getByRole('alert'))
        .filter({ hasText: /at least 3 characters/ }),
    ).toBeVisible();
    expect(api.count(`POST /v1/products/${WHEY.id}/prices`)).toBe(0);

    api.on(`POST /v1/products/${WHEY.id}/prices`, {
      problem: 'BUSINESS_RULE_VIOLATION',
      status: 422,
    });
    await dialog.getByLabel(/^Why is it changing/).fill('Correction');
    await dialog.getByRole('button', { name: 'Save price' }).click();
    await expect(dialog.getByText('The product already has this price.')).toBeVisible();

    api.on(`POST /v1/products/${WHEY.id}/prices`, {
      problem: 'VALIDATION_FAILED',
      problemExtra: {
        errors: [{ field: 'effectiveFrom', message: 'A price cannot start in the past.' }],
      },
    });
    await dialog.getByLabel('Starts').fill('2026-01-01T10:00');
    await dialog.getByRole('button', { name: 'Save price' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'A price cannot start in the past.' }),
    ).toBeVisible();
  });

  test('warns, for people who can see cost, when the new price is below what the product costs', async ({
    page,
    context,
  }) => {
    await openProducts(page, context);
    await page.getByRole('button', { name: /Change the price of Gold Standard/ }).click();
    await page.getByRole('textbox', { name: /Change the price of Gold Standard/ }).fill('2000');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('dialog').getByText('This price is below what the product costs you.'),
    ).toBeVisible();
  });

  test('does not offer to change prices to someone without pricing.write', async ({
    page,
    context,
  }) => {
    await openProducts(page, context, {
      access: {
        ...SAMPLE_ACCESS,
        roleName: 'Editor',
        permissions: ['products.read', 'products.write'],
      },
      items: [WHEY],
    });
    await expect(page.getByRole('button', { name: /Change the price of/ })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: '₹2,999.00' })).toBeVisible();
  });
});

test.describe('the product form', () => {
  async function openNew(
    page: Page,
    context: BrowserContext,
    options = OPTIONS,
    access?: typeof SAMPLE_ACCESS,
  ) {
    const api = await signIn(page, context);
    if (access) {
      api.on('GET /v1/auth/me', {
        json: { user: { ...SAMPLE_USER, isOwner: false }, tenant: SAMPLE_TENANT, access },
      });
    }
    api.on('GET /v1/products/options', { json: options });
    await page.goto('/products/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Add a product' })).toBeVisible();
    await expect(field(page, 'Product name')).toBeVisible();
    return api;
  }

  test('creates a product: rupees become paise, blanks become null, a category suggests HSN and GST', async ({
    page,
    context,
  }) => {
    const api = await openNew(page, context);
    api.on('POST /v1/products', (call) => ({
      status: 201,
      json: { ...WHEY, id: 'new-id', ...(call.body as object) },
    }));
    api.on('GET /v1/products/new-id', { json: withCost(WHEY, 0) });
    await field(page, 'Product name').fill('Gold Standard 100% Whey');
    await field(page, 'Brand').fill('Optimum Nutrition');
    await field(page, 'Variant').fill('2 kg / Chocolate');
    await pick(page, 'Category', 'Protein & whey');
    // The category filled the suggestions; the person did not type them.
    await expect(field(page, 'HSN code')).toHaveValue('21069099');
    await expect(field(page, 'GST rate')).toHaveText(/18%/);
    await field(page, 'Barcode').fill('748927052145');
    await field(page, 'MRP').fill('3,499');
    await field(page, 'Selling price').fill('2999.50');
    await field(page, 'Purchase cost').fill('2400');
    await page.getByRole('button', { name: 'Add product' }).click();

    await expect(page).toHaveURL(/\/products\/new-id$/);
    expect(bodyOf(api, 'POST /v1/products')).toEqual({
      name: 'Gold Standard 100% Whey',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Chocolate',
      categoryId: 'cat-protein',
      sku: null,
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
      purchaseCostPaise: 240_000,
      mrpPaise: 349_900,
      pricePaise: 299_950,
    });
  });

  test('checks amounts and the MRP rule in the browser before any request is sent', async ({
    page,
    context,
  }) => {
    const api = await openNew(page, context);
    await field(page, 'Product name').fill('Whey');
    await field(page, 'MRP').fill('100');
    await field(page, 'Selling price').fill('150');
    await page.getByRole('button', { name: 'Add product' }).click();
    await expect(
      alertOf(page).filter({ hasText: 'The selling price cannot be higher than the MRP.' }),
    ).toBeVisible();
    await field(page, 'Selling price').fill('abc');
    await page.getByRole('button', { name: 'Add product' }).click();
    await expect(alertOf(page).filter({ hasText: /Enter an amount in rupees/ })).toBeVisible();
    expect(api.count('POST /v1/products')).toBe(0);
  });

  test('explains that HSN and GST are required when the business has a GSTIN, and enforces it', async ({
    page,
    context,
  }) => {
    const api = await openNew(page, context, { ...OPTIONS, taxDetailsRequired: true });
    await expect(
      page.getByText(
        'Your business has a GSTIN, so HSN and GST rate are required on every product.',
      ),
    ).toBeVisible();
    await field(page, 'Product name').fill('Whey');
    await field(page, 'MRP').fill('100');
    await field(page, 'Selling price').fill('90');
    await page.getByRole('button', { name: 'Add product' }).click();
    await expect(
      alertOf(page).filter({ hasText: 'HSN is required because your business has a GSTIN.' }),
    ).toBeVisible();
    await expect(
      alertOf(page).filter({ hasText: 'Choose a GST rate because your business has a GSTIN.' }),
    ).toBeVisible();
    expect(api.count('POST /v1/products')).toBe(0);
  });

  test('shows "barcode already used" next to the barcode box', async ({ page, context }) => {
    const api = await openNew(page, context);
    api.on('POST /v1/products', {
      problem: 'CONFLICT',
      problemExtra: {
        errors: [{ field: 'barcode', message: 'Another product already has this barcode.' }],
      },
    });
    await field(page, 'Product name').fill('Whey');
    await field(page, 'Barcode').fill('748927052145');
    await field(page, 'MRP').fill('100');
    await field(page, 'Selling price').fill('90');
    await page.getByRole('button', { name: 'Add product' }).click();
    await expect(
      alertOf(page).filter({ hasText: 'Another product already has this barcode.' }),
    ).toBeVisible();
    await expect(field(page, 'Barcode')).toHaveAttribute('aria-invalid', 'true');
  });

  test('has no cost box, and sends no cost, for someone without products.cost.read', async ({
    page,
    context,
  }) => {
    const api = await openNew(page, context, OPTIONS, {
      ...SAMPLE_ACCESS,
      roleName: 'Editor',
      permissions: ['products.read', 'products.write', 'pricing.write'],
    });
    await expect(page.getByLabel('Purchase cost')).toHaveCount(0);
    api.on('POST /v1/products', (call) => ({
      status: 201,
      json: { ...WHEY, id: 'n2', ...(call.body as object) },
    }));
    api.on('GET /v1/products/n2', { json: WHEY });
    await field(page, 'Product name').fill('Whey');
    await field(page, 'MRP').fill('100');
    await field(page, 'Selling price').fill('90');
    await page.getByRole('button', { name: 'Add product' }).click();
    await expect(page).toHaveURL(/\/products\/n2$/);
    expect('purchaseCostPaise' in bodyOf(api, 'POST /v1/products')).toBe(false);
  });

  test('edits a product: prices are read-only with a "Change price" button, and the history is shown', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/products/options', { json: OPTIONS });
    api.on(`GET /v1/products/${WHEY.id}`, { json: withCost(WHEY, 240_000) });
    api.on(`GET /v1/products/${WHEY.id}/prices`, {
      json: {
        prices: [
          {
            id: 'p3',
            mrpPaise: 349_900,
            pricePaise: 259_900,
            effectiveFrom: '2027-01-01T00:00:00.000Z',
            reason: 'New year sale',
            changedByName: 'Ravi Mehta',
            current: false,
            scheduled: true,
          },
          {
            id: 'p2',
            mrpPaise: 349_900,
            pricePaise: 299_900,
            effectiveFrom: '2026-10-19T09:00:00.000Z',
            reason: 'Supplier price change',
            changedByName: 'Ravi Mehta',
            current: true,
            scheduled: false,
          },
          {
            id: 'p1',
            mrpPaise: 329_900,
            pricePaise: 289_900,
            effectiveFrom: '2026-09-01T09:00:00.000Z',
            reason: 'Initial price',
            changedByName: 'Ravi Mehta',
            current: false,
            scheduled: false,
          },
        ],
      },
    });
    api.on(`PUT /v1/products/${WHEY.id}`, (call) => ({
      json: { ...withCost(WHEY, 240_000), ...(call.body as object) },
    }));
    await page.goto(`/products/${WHEY.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Edit product' })).toBeVisible();
    await expect(field(page, 'Product name')).toHaveValue('Gold Standard 100% Whey');
    await expect(field(page, 'Purchase cost')).toHaveValue('2400');
    // The price is shown, not editable here.
    await expect(page.getByLabel(/^Selling price/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change price' })).toBeVisible();

    const history = page.getByRole('table', { name: 'Price history' });
    await expect(history.getByRole('row', { name: /New year sale/ })).toContainText('Scheduled');
    await expect(history.getByRole('row', { name: /Supplier price change/ })).toContainText(
      'In force now',
    );
    await expect(history.getByRole('row', { name: /Initial price/ })).toContainText('Ravi Mehta');

    // Saving sends the details, never a price.
    await field(page, 'Variant').fill('2 kg / Vanilla');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page).toHaveURL(/\/products$/);
    const sent = bodyOf(api, `PUT /v1/products/${WHEY.id}`);
    expect(sent).toMatchObject({ variant: '2 kg / Vanilla', purchaseCostPaise: 240_000 });
    expect('pricePaise' in sent).toBe(false);
    expect('mrpPaise' in sent).toBe(false);
  });

  test('uploads a picture as a multipart file and refuses a wrong type or a huge file without asking the server', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/products/options', { json: OPTIONS });
    api.on(`GET /v1/products/${WHEY.id}`, { json: withCost(WHEY, 240_000) });
    api.on(`GET /v1/products/${WHEY.id}/prices`, { json: { prices: [] } });
    api.on(`PUT /v1/products/${WHEY.id}/image`, {
      json: withCost({ ...WHEY, hasImage: true }, 240_000),
    });
    await page.goto(`/products/${WHEY.id}`);
    await expect(field(page, 'Product name')).toBeVisible();

    const input = page.getByTestId('product-image-input');
    await input.setInputFiles({
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF'),
    });
    await expect(
      alertOf(page).filter({ hasText: 'Choose a JPEG, PNG or WebP picture.' }),
    ).toBeVisible();
    await input.setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(alertOf(page).filter({ hasText: /over 2 MB/ })).toBeVisible();
    expect(api.count(`PUT /v1/products/${WHEY.id}/image`)).toBe(0);

    await input.setInputFiles({
      name: 'whey.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    await expect(page.getByText('Picture saved.', { exact: true })).toBeVisible();
    expect(api.last(`PUT /v1/products/${WHEY.id}/image`)?.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=/,
    );
  });

  test('says so when the product does not exist', async ({ page, context }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/products/options', { json: OPTIONS });
    api.on('GET /v1/products/0192a3b4-9999-7e8f-9a0b-1c2d3e4f5a6b', { problem: 'NOT_FOUND' });
    await page.goto('/products/0192a3b4-9999-7e8f-9a0b-1c2d3e4f5a6b');
    await expect(alertOf(page).filter({ hasText: 'This product does not exist.' })).toBeVisible();
  });
});

test.describe('the CSV import', () => {
  const REPORT = {
    dryRun: true,
    fileErrors: [],
    ignoredColumns: ['colour'],
    totalRows: 4,
    createdCount: 2,
    failedCount: 2,
    categoriesCreated: ['Brand new category'],
    failedRows: [
      {
        rowNumber: 4,
        errors: [{ field: 'mrp', message: 'Write the MRP in rupees, for example 1499.50.' }],
      },
      {
        rowNumber: 5,
        errors: [
          { field: 'barcode', message: 'Another product already has this barcode.' },
          { field: 'sku', message: 'Another product already has this SKU.' },
        ],
      },
    ],
  };

  async function openImport(page: Page, context: BrowserContext) {
    const api = await signIn(page, context);
    await page.goto('/products/import');
    await expect(page.getByRole('heading', { level: 1, name: 'Import products' })).toBeVisible();
    return api;
  }
  const csv = {
    name: 'products.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,mrp,price\nWhey,100,90'),
  };

  test('checks the file first (saving nothing), shows every failed row, then imports', async ({
    page,
    context,
  }) => {
    const api = await openImport(page, context);
    api.on('POST /v1/products/import', (call) => ({
      json: { ...REPORT, dryRun: call.search.includes('dryRun=true') },
    }));

    await page.getByTestId('import-input').setInputFiles(csv);
    await expect(page.getByText('Selected file: products.csv')).toBeVisible();
    await page.getByRole('button', { name: 'Check the file' }).click();

    const report = page.getByTestId('import-report');
    await expect(
      report.getByRole('heading', { name: 'File checked. Nothing has been saved yet.' }),
    ).toBeVisible();
    await expect(report.getByText(/2 products would be added, 2 rows have problems/)).toBeVisible();
    await expect(report.getByText('New categories: Brand new category')).toBeVisible();
    await expect(report.getByText('Columns not used: colour')).toBeVisible();
    await expect(report.getByRole('row', { name: /Row 4/ })).toContainText(
      'Write the MRP in rupees',
    );
    await expect(report.getByRole('row', { name: /Row 5/ })).toContainText(
      'Another product already has this SKU.',
    );
    expect(api.last('POST /v1/products/import')?.search).toContain('dryRun=true');
    expect(api.last('POST /v1/products/import')?.headers['content-type']).toMatch(
      /^multipart\/form-data/,
    );

    await page.getByRole('button', { name: 'Import the good rows' }).click();
    await expect(report.getByRole('heading', { name: 'Import finished.' })).toBeVisible();
    await expect(report.getByText(/2 products added/)).toBeVisible();
    expect(api.last('POST /v1/products/import')?.search).toContain('dryRun=false');
    await expect(report.getByRole('link', { name: 'Back to products' })).toBeVisible();
  });

  test('refuses a file that is not .csv or is over 2 MB before uploading, and offers a template', async ({
    page,
    context,
  }) => {
    const api = await openImport(page, context);
    await page.getByTestId('import-input').setInputFiles({
      name: 'products.xlsx',
      mimeType: 'application/vnd.ms-excel',
      buffer: Buffer.from('x'),
    });
    await expect(alertOf(page).filter({ hasText: 'Choose a .csv file.' })).toBeVisible();
    await page.getByTestId('import-input').setInputFiles({
      name: 'big.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
    await expect(alertOf(page).filter({ hasText: /over 2 MB/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check the file' })).toBeDisabled();
    expect(api.count('POST /v1/products/import')).toBe(0);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download a template' }).click();
    expect((await download).suggestedFilename()).toBe('dumbbill-products-template.csv');
  });

  test('shows problems with the file itself (a missing column) in plain words', async ({
    page,
    context,
  }) => {
    const api = await openImport(page, context);
    api.on('POST /v1/products/import', {
      json: {
        ...REPORT,
        fileErrors: ['The file has no "price" column.'],
        totalRows: 0,
        createdCount: 0,
        failedCount: 0,
        failedRows: [],
        categoriesCreated: [],
      },
    });
    await page.getByTestId('import-input').setInputFiles(csv);
    await page.getByRole('button', { name: 'Check the file' }).click();
    await expect(
      alertOf(page).filter({ hasText: 'The file has no "price" column.' }),
    ).toBeVisible();
  });
});

test.describe('the first-steps checklist', () => {
  test('has an "Add products" step that links to the products screen', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/business/onboarding', {
      json: {
        steps: [
          { key: 'PROFILE', done: true },
          { key: 'BRANCH', done: true },
          { key: 'PRODUCTS', done: false },
          { key: 'TEAM', done: false },
        ],
        gstinMissing: false,
      },
    });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Add products' })).toHaveAttribute(
      'href',
      '/products',
    );
    await expect(page.getByText('2 of 4 done')).toBeVisible();
  });
});

/** Every new screen, in both themes, must pass the automatic accessibility check. */
for (const theme of THEMES) {
  const screens: Array<{
    name: string;
    path: string;
    heading: string;
    prepare: (api: MockApi) => void;
    after?: (page: Page) => Promise<void>;
  }> = [
    {
      name: 'products',
      path: '/products',
      heading: 'Products',
      prepare: (api) => {
        api.on('GET /v1/products', {
          json: {
            items: [withCost(WHEY, 240_000), withCost(CREATINE, 120_000)],
            total: 2,
            limit: 50,
            offset: 0,
          },
        });
        api.on('GET /v1/products/options', { json: OPTIONS });
      },
    },
    {
      name: 'new product',
      path: '/products/new',
      heading: 'Add a product',
      prepare: (api) => api.on('GET /v1/products/options', { json: OPTIONS }),
    },
    {
      name: 'edit product',
      path: `/products/${WHEY.id}`,
      heading: 'Edit product',
      prepare: (api) => {
        api.on('GET /v1/products/options', { json: OPTIONS });
        api.on(`GET /v1/products/${WHEY.id}`, { json: withCost(WHEY, 240_000) });
        api.on(`GET /v1/products/${WHEY.id}/prices`, {
          json: {
            prices: [
              {
                id: 'p1',
                mrpPaise: 349_900,
                pricePaise: 299_900,
                effectiveFrom: '2026-10-19T09:00:00.000Z',
                reason: 'Initial price',
                changedByName: 'Ravi Mehta',
                current: true,
                scheduled: false,
              },
            ],
          },
        });
      },
    },
    {
      name: 'price dialog',
      path: '/products',
      heading: 'Products',
      prepare: (api) => {
        api.on('GET /v1/products', {
          json: { items: [withCost(WHEY, 240_000)], total: 1, limit: 50, offset: 0 },
        });
        api.on('GET /v1/products/options', { json: OPTIONS });
      },
      after: async (page) => {
        await page.getByRole('button', { name: /Change the price of Gold Standard/ }).click();
        await page.getByRole('textbox', { name: /Change the price of Gold Standard/ }).fill('2799');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog')).toBeVisible();
      },
    },
    {
      name: 'import with report',
      path: '/products/import',
      heading: 'Import products',
      prepare: (api) =>
        api.on('POST /v1/products/import', {
          json: {
            dryRun: true,
            fileErrors: [],
            ignoredColumns: [],
            totalRows: 2,
            createdCount: 1,
            failedCount: 1,
            categoriesCreated: [],
            failedRows: [
              {
                rowNumber: 3,
                errors: [
                  { field: 'mrp', message: 'Write the MRP in rupees, for example 1499.50.' },
                ],
              },
            ],
          },
        }),
      after: async (page) => {
        await page.getByTestId('import-input').setInputFiles({
          name: 'products.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('name,mrp,price\nWhey,100,90'),
        });
        await page.getByRole('button', { name: 'Check the file' }).click();
        await expect(page.getByTestId('import-report')).toBeVisible();
      },
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
      await expect(page.locator('main#main [role="status"][aria-label^="Loading"]')).toHaveCount(0);
      await screen.after?.(page);
      await page.screenshot({
        path: `test-results/screens/products-${screen.name.replace(/[^a-z]+/g, '-')}-${theme}.png`,
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
