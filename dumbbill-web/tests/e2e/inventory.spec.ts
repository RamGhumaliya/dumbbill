import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MockApi, SAMPLE_ACCESS, SAMPLE_TENANT, SAMPLE_USER, signIn } from './support/mock-api';

/**
 * Suppliers, purchases, stock and the audit log as a person meets them, in a real browser against a pretend API
 * (support/mock-api.ts). What the real server does (the weighted average, locking, idempotency, tamper detection) is proven by
 * the backend's own tests; here the question is: does each SCREEN say the right words, send the right request (money in
 * paise, one Idempotency-Key per form), show server messages next to the right box, and keep cost out of sight of people who
 * may not see it.
 */

const THEMES = ['dark', 'light'] as const;

const MAIN = {
  id: 'br-main',
  name: 'Main branch',
  isActive: true,
  invoicePrefix: 'MAIN',
  printerWidthMm: 80,
  stateCode: '27',
  stateName: 'Maharashtra',
  gstin: null,
  addressLine: null,
  city: 'Pune',
  pincode: null,
  phone: null,
};
const BANER = { ...MAIN, id: 'br-baner', name: 'Baner shop', invoicePrefix: 'BAN' };
const BRANCHES = { branches: [MAIN, BANER], limit: { max: 3, used: 2 } };

const NUTRI = {
  id: 'sup-1',
  name: 'Nutri Distributors Pvt Ltd',
  gstin: '27AAPFU0939F1ZV',
  phone: '+919822012345',
  email: null,
  addressLine: null,
  city: 'Pune',
  notes: null,
  isActive: true,
  balancePaise: 1_250_000,
};
const FITMART = {
  ...NUTRI,
  id: 'sup-2',
  name: 'FitMart Wholesale',
  gstin: null,
  phone: null,
  city: null,
  balancePaise: 0,
};

const WHEY = {
  id: 'p-whey',
  name: 'Gold Standard 100% Whey',
  brand: 'Optimum Nutrition',
  variant: '2 kg / Chocolate',
  categoryId: null,
  categoryName: null,
  sku: null,
  barcode: '748927052145',
  hsn: null,
  gstRateBp: null,
  mrpPaise: 349_900,
  pricePaise: 299_900,
  hasImage: false,
  isActive: true,
};
const CREATINE = {
  ...WHEY,
  id: 'p-creatine',
  name: 'Creatine Monohydrate',
  brand: 'MuscleBlaze',
  variant: '250 g',
  barcode: '8904000111',
};
const labelOf = (p: typeof WHEY) => `${p.name} · ${p.brand} · ${p.variant} (${p.barcode})`;

const CASHIER_ACCESS = {
  ...SAMPLE_ACCESS,
  roleName: 'Cashier',
  permissions: ['products.read', 'pos.sell'],
};

function field(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByLabel(new RegExp(`^${escaped}\\s*\\*?$`));
}
function alertOf(page: Page) {
  return page.locator('main#main').getByRole('alert');
}
function bodyOf(api: MockApi, key: string): Record<string, unknown> {
  return (api.last(key)?.body ?? {}) as Record<string, unknown>;
}

/** Sign in with the given access (default: the owner, who may do everything) and answer the calls every screen makes. */
async function start(page: Page, context: BrowserContext, access?: typeof SAMPLE_ACCESS) {
  const api = await signIn(page, context);
  if (access) {
    api.on('GET /v1/auth/me', {
      json: { user: { ...SAMPLE_USER, isOwner: false }, tenant: SAMPLE_TENANT, access },
    });
  }
  api.on('GET /v1/branches', { json: BRANCHES });
  api.on('GET /v1/suppliers', { json: { suppliers: [NUTRI, FITMART] } });
  api.on('GET /v1/products', (call) => {
    // Like the real search: the text must appear in the name, brand, variant or barcode (never in a made-up label).
    const q = (new URLSearchParams(call.search).get('q') ?? '').toLowerCase();
    const items = [WHEY, CREATINE].filter((p) =>
      [p.name, p.brand, p.variant, p.barcode].some((field) => field.toLowerCase().includes(q)),
    );
    return { json: { items, total: items.length, limit: 10, offset: 0 } };
  });
  return api;
}

/** Pick a product in a datalist-backed box: type a few letters (so suggestions load), then choose the full label. */
async function pickProduct(
  page: Page,
  api: MockApi,
  boxName: string | RegExp,
  product: typeof WHEY,
) {
  const box = page.getByRole('combobox', { name: boxName });
  const before = api.count('GET /v1/products');
  await box.fill(product.name.slice(0, 4));
  await expect.poll(() => api.count('GET /v1/products')).toBeGreaterThan(before);
  await box.fill(labelOf(product));
}

async function pick(page: Page, label: string, option: string | RegExp) {
  await field(page, label).click();
  await page.getByRole('option', { name: option }).click();
}

// ------------------------------------------------------------------------------------------------

test.describe('suppliers', () => {
  test('lists suppliers with what is owed to each, and says that payments are not recorded yet', async ({
    page,
    context,
  }) => {
    await start(page, context);
    await page.goto('/suppliers');
    await expect(page.getByRole('heading', { level: 1, name: 'Suppliers' })).toBeVisible();
    const row = page.getByRole('row', { name: /Nutri Distributors/ });
    await expect(row).toContainText('₹12,500.00');
    await expect(row).toContainText('27AAPFU0939F1ZV');
    await expect(page.getByText(/Payments are not recorded yet/)).toBeVisible();
  });

  test('adds a supplier: the GSTIN is cleaned, blanks become null, and a repeated name is shown under the name box', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    await page.goto('/suppliers');
    await page.getByRole('button', { name: 'Add a supplier' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a supplier' });

    // A GSTIN of the wrong shape is refused in the browser, before any request.
    await dialog.getByLabel(/^Supplier name/).fill('New Nutrition Co');
    await dialog.getByLabel('GSTIN').fill('NOT-A-GSTIN');
    await dialog.getByRole('button', { name: 'Save supplier' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: /15 letters and digits/ }),
    ).toBeVisible();
    expect(api.count('POST /v1/suppliers')).toBe(0);

    api.on('POST /v1/suppliers', {
      problem: 'CONFLICT',
      problemExtra: {
        errors: [{ field: 'name', message: 'A supplier with this name already exists.' }],
      },
    });
    await dialog.getByLabel('GSTIN').fill('27 aapfu 0939 f1zv');
    await dialog.getByRole('button', { name: 'Save supplier' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'A supplier with this name already exists.' }),
    ).toBeVisible();
    expect(bodyOf(api, 'POST /v1/suppliers')).toMatchObject({
      name: 'New Nutrition Co',
      gstin: '27AAPFU0939F1ZV',
      phone: null,
      email: null,
      city: null,
    });

    api.on('POST /v1/suppliers', {
      status: 201,
      json: { ...FITMART, id: 'sup-3', name: 'New Nutrition Co' },
    });
    await dialog.getByRole('button', { name: 'Save supplier' }).click();
    await expect(page.getByText('Supplier added.', { exact: true })).toBeVisible();
  });

  test('switches a supplier off', async ({ page, context }) => {
    const api = await start(page, context);
    api.on('POST /v1/suppliers/sup-1/deactivate', { json: { ...NUTRI, isActive: false } });
    await page.goto('/suppliers');
    await page.getByRole('button', { name: 'Switch off Nutri Distributors Pvt Ltd' }).click();
    await expect(page.getByText('Supplier switched off.', { exact: true })).toBeVisible();
    expect(api.count('POST /v1/suppliers/sup-1/deactivate')).toBe(1);
  });

  test('a person without purchases.write has no menu links and is told they cannot open the page', async ({
    page,
    context,
  }) => {
    const api = await start(page, context, CASHIER_ACCESS);
    api.on('GET /v1/suppliers', { problem: 'FORBIDDEN' });
    await page.goto('/suppliers');
    await expect(
      alertOf(page).filter({ hasText: 'You do not have permission to do this.' }),
    ).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Suppliers' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Purchases' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Stock' })).toBeVisible();
  });
});

// ------------------------------------------------------------------------------------------------

const PURCHASE = {
  id: 'pu-1',
  branchId: 'br-main',
  branchName: 'Main branch',
  supplierId: 'sup-1',
  supplierName: 'Nutri Distributors Pvt Ltd',
  invoiceRef: 'NDP/2410/0417',
  invoiceDate: '2026-10-19',
  otherCostPaise: 40_000,
  subtotalPaise: 400_000,
  totalPaise: 440_000,
  note: null,
  createdByName: 'Ravi Mehta',
  createdAt: '2026-10-19T10:00:00.000Z',
  lines: [
    {
      productId: 'p-whey',
      productName: WHEY.name,
      brand: WHEY.brand,
      variant: WHEY.variant,
      qty: 10,
      unitCostPaise: 10_000,
      allocatedCostPaise: 10_000,
      lineTotalPaise: 110_000,
      landedUnitCostPaise: 11_000,
      batchNo: 'WH2410A',
      expiryDate: '2027-09-30',
    },
    {
      productId: 'p-creatine',
      productName: CREATINE.name,
      brand: CREATINE.brand,
      variant: CREATINE.variant,
      qty: 30,
      unitCostPaise: 10_000,
      allocatedCostPaise: 30_000,
      lineTotalPaise: 330_000,
      landedUnitCostPaise: 11_000,
      batchNo: null,
      expiryDate: null,
    },
  ],
};

test.describe('purchases', () => {
  test('lists purchases and opens one (read-only, with landed cost per unit and the total owed)', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('GET /v1/purchases', {
      json: {
        items: [
          {
            id: 'pu-1',
            invoiceRef: 'NDP/2410/0417',
            invoiceDate: '2026-10-19',
            supplierName: NUTRI.name,
            branchName: 'Main branch',
            lineCount: 2,
            totalPaise: 440_000,
            createdAt: '2026-10-19T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      },
    });
    api.on('GET /v1/purchases/pu-1', { json: PURCHASE });
    await page.goto('/purchases');
    const row = page.getByRole('row', { name: /NDP\/2410\/0417/ });
    await expect(row).toContainText('2 lines');
    await expect(row).toContainText('₹4,400.00');
    await row.getByRole('link', { name: 'NDP/2410/0417' }).click();
    await expect(page.getByRole('row', { name: /Gold Standard/ })).toContainText('₹110.00');
    await expect(page.getByRole('row', { name: /Gold Standard/ })).toContainText('WH2410A');
    await expect(page.getByText('Total owed')).toBeVisible();
    await expect(page.getByText('Entered by Ravi Mehta')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('shows an empty state with a way to record the first purchase', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('GET /v1/purchases', { json: { items: [], total: 0, limit: 50, offset: 0 } });
    await page.goto('/purchases');
    await expect(page.getByRole('heading', { name: 'No purchases yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record a purchase' }).first()).toBeVisible();
  });
});

async function openNewPurchase(page: Page, context: BrowserContext, access?: typeof SAMPLE_ACCESS) {
  const api = await start(page, context, access);
  api.on('GET /v1/stock', (call) => {
    const q = new URLSearchParams(call.search);
    // Whey: 2 held at Rs 100 each (value Rs 200). Creatine: nothing held.
    const rows = [
      {
        productId: 'p-whey',
        productName: WHEY.name,
        brand: WHEY.brand,
        variant: WHEY.variant,
        barcode: WHEY.barcode,
        qty: 2,
        minQty: null,
        isLow: false,
        wacPaise: 10_000,
        valuePaise: 20_000,
      },
      {
        productId: 'p-creatine',
        productName: CREATINE.name,
        brand: CREATINE.brand,
        variant: CREATINE.variant,
        barcode: CREATINE.barcode,
        qty: 0,
        minQty: null,
        isLow: false,
        wacPaise: 0,
        valuePaise: 0,
      },
    ];
    return { json: { branchId: q.get('branchId'), items: rows, total: 2, limit: 10, offset: 0 } };
  });
  await page.goto('/purchases/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Record a purchase' })).toBeVisible();
  await pick(page, 'Supplier', /Nutri Distributors/);
  await pick(page, 'Branch', /Main branch/);
  return api;
}

test.describe('recording a purchase (spreadsheet entry)', () => {
  test('shows the landed cost of each line and the new average cost as the person types, with freight shared by value', async ({
    page,
    context,
  }) => {
    const api = await openNewPurchase(page, context);
    await pickProduct(page, api, /Product, Line 1/, WHEY);
    await page.getByRole('textbox', { name: /^Qty, Line 1/ }).fill('10');
    await page.getByRole('textbox', { name: /^Unit cost, Line 1/ }).fill('100');
    await page.getByRole('button', { name: 'Add a line' }).click();
    await pickProduct(page, api, /Product, Line 2/, CREATINE);
    await page.getByRole('textbox', { name: /^Qty, Line 2/ }).fill('30');
    await page.getByRole('textbox', { name: /^Unit cost, Line 2/ }).fill('100');
    await field(page, 'Freight and other costs').first().fill('400');

    const line1 = page.getByRole('row', { name: /Line 1/ });
    const line2 = page.getByRole('row', { name: /Line 2/ });
    // Rs 400 freight over Rs 1,000 and Rs 3,000: shares Rs 100 and Rs 300, landed Rs 1,100 and Rs 3,300.
    await expect(line1).toContainText('₹1,100.00');
    await expect(line2).toContainText('₹3,300.00');
    // Whey: 2 held worth Rs 200 + landed Rs 1,100 over 12 units = Rs 108.33 average.
    await expect(line1).toContainText('₹108.33');
    await expect(line1).toContainText('2 now, average ₹100.00');
    await expect(page.getByText('Items total').locator('..')).toContainText('₹4,000.00');
    await expect(page.getByText('You owe the supplier').locator('..')).toContainText('₹4,400.00');
  });

  test('sends money in paise, blanks as null, and ONE Idempotency-Key, reused when the person retries after a failure', async ({
    page,
    context,
  }) => {
    const api = await openNewPurchase(page, context);
    await pickProduct(page, api, /Product, Line 1/, WHEY);
    await page.getByRole('textbox', { name: /^Qty, Line 1/ }).fill('24');
    await page.getByRole('textbox', { name: /^Unit cost, Line 1/ }).fill('2,499.50');
    await page.getByRole('textbox', { name: /^Batch no\., Line 1/ }).fill('WH2410A');
    await page.getByLabel(/^Expiry, Line 1/).fill('2030-09-30');
    await field(page, "Supplier's invoice number").fill('NDP/2410/0417');
    await field(page, 'Freight and other costs').first().fill('1500');

    api.on('POST /v1/purchases', { problem: 'INTERNAL_ERROR', status: 500 });
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(alertOf(page).filter({ hasText: /Something went wrong/ })).toBeVisible();

    api.on('POST /v1/purchases', { status: 201, json: PURCHASE });
    api.on('GET /v1/purchases/pu-1', { json: PURCHASE });
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(page).toHaveURL(/\/purchases\/pu-1$/);

    const calls = api.calls.filter((c) => c.method === 'POST' && c.path === '/v1/purchases');
    expect(calls).toHaveLength(2);
    const keys = calls.map((c) => c.headers['idempotency-key']);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(bodyOf(api, 'POST /v1/purchases')).toMatchObject({
      supplierId: 'sup-1',
      branchId: 'br-main',
      invoiceRef: 'NDP/2410/0417',
      otherCostPaise: 150_000,
      note: null,
      lines: [
        {
          productId: 'p-whey',
          qty: 24,
          unitCostPaise: 249_950,
          batchNo: 'WH2410A',
          expiryDate: '2030-09-30',
        },
      ],
    });
  });

  test("puts server messages next to the right cell (a line's expiry) and the right box (a repeated invoice number)", async ({
    page,
    context,
  }) => {
    const api = await openNewPurchase(page, context);
    await pickProduct(page, api, /Product, Line 1/, WHEY);
    await page.getByRole('textbox', { name: /^Qty, Line 1/ }).fill('1');
    await page.getByRole('textbox', { name: /^Unit cost, Line 1/ }).fill('100');
    await field(page, "Supplier's invoice number").fill('DUP-1');

    api.on('POST /v1/purchases', {
      problem: 'VALIDATION_FAILED',
      problemExtra: {
        errors: [{ field: 'lines[0].expiryDate', message: 'This batch has already expired.' }],
      },
    });
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(
      alertOf(page).filter({ hasText: 'This batch has already expired.' }),
    ).toBeVisible();
    await expect(page.getByLabel(/^Expiry, Line 1/)).toHaveAttribute('aria-invalid', 'true');

    api.on('POST /v1/purchases', {
      problem: 'CONFLICT',
      problemExtra: {
        errors: [
          { field: 'invoiceRef', message: "This supplier's invoice number is already entered." },
        ],
      },
    });
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(
      alertOf(page).filter({ hasText: "This supplier's invoice number is already entered." }),
    ).toBeVisible();
  });

  test('checks the bill in the browser first: no product, a bad quantity, a bad amount and a past expiry send nothing', async ({
    page,
    context,
  }) => {
    const api = await openNewPurchase(page, context);
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(
      alertOf(page).filter({ hasText: "Enter the supplier's invoice number." }),
    ).toBeVisible();
    await expect(alertOf(page).filter({ hasText: 'Pick a product from the list.' })).toBeVisible();
    await page.getByRole('textbox', { name: /^Qty, Line 1/ }).fill('0');
    await page.getByRole('textbox', { name: /^Unit cost, Line 1/ }).fill('abc');
    await page.getByLabel(/^Expiry, Line 1/).fill('2020-01-01');
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(
      alertOf(page).filter({ hasText: 'Enter a whole number of units, at least 1.' }),
    ).toBeVisible();
    await expect(
      alertOf(page).filter({ hasText: 'Enter an amount in rupees, for example 2499.' }),
    ).toBeVisible();
    await expect(alertOf(page).filter({ hasText: /Enter a date like 2027-09-30/ })).toBeVisible();
    expect(api.count('POST /v1/purchases')).toBe(0);
  });

  test('Enter moves through the cells and starts a new line after the last cell, and a barcode scan picks the product', async ({
    page,
    context,
  }) => {
    const api = await openNewPurchase(page, context);
    api.on(`GET /v1/products/by-barcode/${CREATINE.barcode}`, { json: CREATINE });
    const box = page.getByRole('combobox', { name: /Product, Line 1/ });
    // A scanner types the barcode and presses Enter.
    await box.fill(CREATINE.barcode);
    await box.press('Enter');
    await expect(box).toHaveValue(labelOf(CREATINE));
    await expect(page.getByRole('textbox', { name: /^Qty, Line 1/ })).toBeFocused();

    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: /^Unit cost, Line 1/ })).toBeFocused();
    await page.keyboard.type('50');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(/^Expiry, Line 1/)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: /Product, Line 2/ })).toBeFocused();
  });

  test('picks the product even when the full name is pasted before the suggestions have arrived', async ({
    page,
    context,
  }) => {
    const api = await openNewPurchase(page, context);
    // Slow the suggestions down so the text is certainly there first.
    api.on('GET /v1/products', async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { json: { items: [WHEY], total: 1, limit: 10, offset: 0 } };
    });
    await page.getByRole('combobox', { name: /Product, Line 1/ }).fill(labelOf(WHEY));
    await expect(page.getByRole('textbox', { name: /^Qty, Line 1/ })).toBeFocused();
    await page.getByRole('textbox', { name: /^Qty, Line 1/ }).fill('2');
    await page.getByRole('textbox', { name: /^Unit cost, Line 1/ }).fill('100');
    await expect(page.getByRole('row', { name: /Line 1/ })).toContainText('₹200.00');
  });

  test('a line can be removed, but the last one stays', async ({ page, context }) => {
    await openNewPurchase(page, context);
    await expect(page.getByRole('button', { name: /Remove line/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Add a line' }).click();
    await page.getByRole('button', { name: 'Remove line 2' }).click();
    await expect(page.getByRole('combobox', { name: /Product, Line 2/ })).toHaveCount(0);
  });
});

// ------------------------------------------------------------------------------------------------

test.describe('supplier returns (debit notes)', () => {
  test('lists debit notes with their credit', async ({ page, context }) => {
    const api = await start(page, context);
    api.on('GET /v1/supplier-returns', {
      json: {
        items: [
          {
            id: 'r1',
            debitNoteNo: 'DN-0007',
            supplierId: 'sup-1',
            supplierName: NUTRI.name,
            branchId: 'br-main',
            branchName: 'Main branch',
            reason: 'Damaged in transit',
            creditTotalPaise: 76_000,
            note: null,
            createdAt: '2026-10-19T10:00:00.000Z',
            lines: [],
          },
        ],
      },
    });
    await page.goto('/purchases/returns');
    await expect(page.getByRole('row', { name: /DN-0007/ })).toContainText('₹760.00');
  });

  test('explains when the stock is not enough, and sends one key and credit in paise', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    await page.goto('/purchases/returns/new');
    await pick(page, 'Supplier', /Nutri Distributors/);
    await pick(page, 'Branch', /Main branch/);
    await field(page, 'Reason').fill('Damaged in transit');
    await pickProduct(page, api, /Product, Line 1/, WHEY);
    await page.getByRole('textbox', { name: /^Qty, Line 1/ }).fill('6');
    await page.getByRole('textbox', { name: /^Credit per unit, Line 1/ }).fill('2499');
    await expect(page.getByText('Total credit').locator('..')).toContainText('₹14,994.00');

    api.on('POST /v1/supplier-returns', {
      problem: 'INSUFFICIENT_STOCK',
      status: 422,
      problemExtra: { detail: 'Only 2 in stock, but 6 are needed.' },
    });
    await page.getByRole('button', { name: 'Create debit note' }).click();
    await expect(
      alertOf(page).filter({ hasText: /Only 2 in stock, but 6 are needed/ }),
    ).toBeVisible();

    api.on('POST /v1/supplier-returns', {
      status: 201,
      json: {
        id: 'r2',
        debitNoteNo: 'DN-0008',
        supplierId: 'sup-1',
        supplierName: NUTRI.name,
        branchId: 'br-main',
        branchName: 'Main branch',
        reason: 'x',
        creditTotalPaise: 1,
        note: null,
        createdAt: '2026-10-19T10:00:00.000Z',
        lines: [],
      },
    });
    api.on('GET /v1/supplier-returns', { json: { items: [] } });
    await page.getByRole('button', { name: 'Create debit note' }).click();
    await expect(page).toHaveURL(/\/purchases\/returns$/);
    const calls = api.calls.filter((c) => c.method === 'POST' && c.path === '/v1/supplier-returns');
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    expect(bodyOf(api, 'POST /v1/supplier-returns')).toMatchObject({
      reason: 'Damaged in transit',
      lines: [{ productId: 'p-whey', qty: 6, unitCreditPaise: 249_900 }],
    });
  });
});

// ------------------------------------------------------------------------------------------------

const STOCK_ROW = (overrides: Record<string, unknown> = {}) => ({
  productId: 'p-whey',
  productName: WHEY.name,
  brand: WHEY.brand,
  variant: WHEY.variant,
  barcode: WHEY.barcode,
  qty: 18,
  minQty: 6,
  isLow: false,
  wacPaise: 250_025,
  valuePaise: 4_500_450,
  ...overrides,
});
const STOCK_LIST = (rows: object[]) => ({
  json: { branchId: 'br-main', items: rows, total: rows.length, limit: 50, offset: 0 },
});
const CASHIER_ROW = (overrides: Record<string, unknown> = {}) => {
  const {
    wacPaise: _wac,
    valuePaise: _value,
    ...rest
  } = STOCK_ROW(overrides) as Record<string, unknown>;
  void _wac;
  void _value;
  return rest;
};

const LEDGER = {
  items: [
    {
      id: 'l2',
      createdAt: '2026-10-19T11:00:00.000Z',
      type: 'ADJUSTMENT_OUT',
      productId: 'p-whey',
      productName: WHEY.name,
      qtyDelta: -3,
      qtyAfter: 18,
      batchNo: 'WH2410A',
      expiryDate: '2027-09-30',
      refType: 'ADJUSTMENT',
      refId: null,
      reason: 'DAMAGE',
      note: 'Three tubs split',
      createdByName: 'Ravi Mehta',
      unitCostPaise: 250_025,
      valueDeltaPaise: -750_075,
      wacAfterPaise: 250_025,
      valueAfterPaise: 4_500_450,
    },
    {
      id: 'l1',
      createdAt: '2026-10-19T10:00:00.000Z',
      type: 'PURCHASE',
      productId: 'p-whey',
      productName: WHEY.name,
      qtyDelta: 21,
      qtyAfter: 21,
      batchNo: 'WH2410A',
      expiryDate: '2027-09-30',
      refType: 'PURCHASE',
      refId: 'pu-1',
      reason: null,
      note: null,
      createdByName: 'Ravi Mehta',
      unitCostPaise: 250_025,
      valueDeltaPaise: 5_250_525,
      wacAfterPaise: 250_025,
      valueAfterPaise: 5_250_525,
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

async function openStock(
  page: Page,
  context: BrowserContext,
  access?: typeof SAMPLE_ACCESS,
  rows: object[] = [STOCK_ROW()],
) {
  const api = await start(page, context, access);
  api.on('GET /v1/stock', STOCK_LIST(rows));
  await page.goto('/stock');
  await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Gold Standard/ })).toBeVisible();
  return api;
}

test.describe('the stock page', () => {
  test('shows quantity, a Low badge, and (for people with cost access) average cost and value', async ({
    page,
    context,
  }) => {
    await openStock(page, context, undefined, [STOCK_ROW({ qty: 2, isLow: true })]);
    const row = page.getByRole('row', { name: /Gold Standard/ });
    await expect(row).toContainText('Low');
    await expect(row).toContainText('₹2,500.25');
    await expect(row).toContainText('₹45,004.50');
    await expect(page.getByRole('tab', { name: 'Alerts' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Transfers' })).toBeVisible();
  });

  test('has NO cost columns, no history or count buttons, and no Alerts or Transfers tabs for a cashier', async ({
    page,
    context,
  }) => {
    await openStock(page, context, CASHIER_ACCESS, [CASHIER_ROW()]);
    await expect(page.getByRole('columnheader', { name: 'Average cost' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Stock value' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^History/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Alerts' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Transfers' })).toHaveCount(0);
    await expect(page.locator('main#main')).not.toContainText('2,500.25');
  });

  test('sends the branch, search and low-only filter the person chose', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    await page.getByLabel('Search products').fill('whey');
    await expect.poll(() => api.last('GET /v1/stock')?.search).toContain('q=whey');
    await page.getByRole('checkbox', { name: 'Only low stock' }).click();
    await expect.poll(() => api.last('GET /v1/stock')?.search).toContain('lowOnly=true');
    await field(page, 'Branch').click();
    await page.getByRole('option', { name: 'Baner shop' }).click();
    await expect.poll(() => api.last('GET /v1/stock')?.search).toContain('branchId=br-baner');
  });

  test('opens the history of a product: every movement, with costs only for people who may see them', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    api.on('GET /v1/stock/ledger', { json: LEDGER });
    await page.getByRole('button', { name: 'History of Gold Standard 100% Whey' }).click();
    const dialog = page.getByRole('dialog', { name: 'History of Gold Standard 100% Whey' });
    await expect(dialog.getByRole('row', { name: /Purchase/ })).toContainText('+21');
    await expect(dialog.getByRole('row', { name: /Count: missing/ })).toContainText('-3');
    await expect(dialog.getByRole('row', { name: /Count: missing/ })).toContainText('Damage');
    await expect(dialog.getByRole('row', { name: /Count: missing/ })).toContainText(
      'Three tubs split',
    );
    await expect(dialog.getByRole('columnheader', { name: 'Unit cost' })).toBeVisible();
    expect(api.last('GET /v1/stock/ledger')?.search).toContain('productId=p-whey');
  });

  test('the history has no cost columns for someone who may count stock but not see costs', async ({
    page,
    context,
  }) => {
    const api = await openStock(
      page,
      context,
      { ...SAMPLE_ACCESS, roleName: 'Counter', permissions: ['products.read', 'stock.adjust'] },
      [CASHIER_ROW()],
    );
    api.on('GET /v1/stock/ledger', {
      json: {
        ...LEDGER,
        items: LEDGER.items.map(
          ({
            unitCostPaise: _u,
            valueDeltaPaise: _v,
            wacAfterPaise: _w,
            valueAfterPaise: _a,
            ...rest
          }) => {
            void [_u, _v, _w, _a];
            return rest;
          },
        ),
      },
    });
    await page.getByRole('button', { name: 'History of Gold Standard 100% Whey' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('row', { name: /Purchase/ })).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: 'Unit cost' })).toHaveCount(0);
    await expect(dialog.getByRole('columnheader', { name: 'Average after' })).toHaveCount(0);
  });

  test('counts stock with a reason and one key; a count equal to the books still lets the low-stock level be saved', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    api.on('POST /v1/stock/adjustments', {
      status: 201,
      json: { productId: 'p-whey', branchId: 'br-main', qtyBefore: 18, qtyAfter: 15 },
    });
    api.on('PUT /v1/stock/thresholds', {
      json: { branchId: 'br-main', productId: 'p-whey', minQty: 10 },
    });
    await page.getByRole('button', { name: 'Count Gold Standard 100% Whey' }).click();
    const dialog = page.getByRole('dialog', { name: 'Count Gold Standard 100% Whey' });
    await expect(dialog.getByText('The books say 18.')).toBeVisible();
    await dialog.getByLabel(/^Counted quantity/).fill('15');
    await dialog.getByRole('combobox', { name: 'Reason' }).click();
    await page.getByRole('option', { name: 'Damage' }).click();
    await dialog.getByLabel('Note').fill('Three tubs split');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Stock counted.', { exact: true })).toBeVisible();
    expect(api.last('POST /v1/stock/adjustments')?.headers['idempotency-key']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(bodyOf(api, 'POST /v1/stock/adjustments')).toEqual({
      branchId: 'br-main',
      productId: 'p-whey',
      countedQty: 15,
      reason: 'DAMAGE',
      note: 'Three tubs split',
    });
    expect(api.count('PUT /v1/stock/thresholds')).toBe(0);

    // Same count as the books, new level: only the level is saved.
    await page.getByRole('button', { name: 'Count Gold Standard 100% Whey' }).click();
    await page.getByLabel('Low-stock level').fill('10');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => api.count('PUT /v1/stock/thresholds')).toBe(1);
    expect(api.count('POST /v1/stock/adjustments')).toBe(1);
    expect(bodyOf(api, 'PUT /v1/stock/thresholds')).toEqual({
      branchId: 'br-main',
      productId: 'p-whey',
      minQty: 10,
    });
  });

  test('refuses a count that is not a whole number without asking the server', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    await page.getByRole('button', { name: 'Count Gold Standard 100% Whey' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Counted quantity/).fill('-2');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'Enter a whole number, 0 or more.' }),
    ).toBeVisible();
    expect(api.count('POST /v1/stock/adjustments')).toBe(0);
  });

  test('says so when the count already matches the books', async ({ page, context }) => {
    const api = await openStock(page, context);
    api.on('POST /v1/stock/adjustments', { problem: 'BUSINESS_RULE_VIOLATION', status: 422 });
    await page.getByRole('button', { name: 'Count Gold Standard 100% Whey' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Counted quantity/).fill('3');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'The count matches the books.' }),
    ).toBeVisible();
  });
});

const ALERTS = {
  nearExpiryDays: 60,
  lowStock: [
    {
      branchId: 'br-main',
      branchName: 'Main branch',
      productId: 'p-whey',
      productName: WHEY.name,
      qty: 2,
      minQty: 6,
    },
  ],
  nearExpiry: [
    {
      batchId: 'b1',
      branchId: 'br-main',
      branchName: 'Main branch',
      productId: 'p-creatine',
      productName: CREATINE.name,
      batchNo: 'CR1',
      expiryDate: '2026-12-01',
      qtyRemaining: 12,
      daysLeft: 43,
    },
  ],
  expired: [
    {
      batchId: 'b2',
      branchId: 'br-main',
      branchName: 'Main branch',
      productId: 'p-whey',
      productName: WHEY.name,
      batchNo: 'OLD',
      expiryDate: '2026-10-01',
      qtyRemaining: 4,
      daysLeft: -18,
    },
  ],
};

test.describe('stock alerts', () => {
  test('lists low stock, near expiry and expired batches, and writes off an expired one with a key', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    api.on('GET /v1/stock/alerts', { json: ALERTS });
    api.on('POST /v1/stock/write-offs', {
      status: 201,
      json: { productId: 'p-whey', branchId: 'br-main', qtyBefore: 22, qtyAfter: 18 },
    });
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await expect(page.getByText('Near expiry means within 60 days.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Gold Standard/ }).first()).toContainText('2');
    await expect(page.getByRole('row', { name: /Creatine/ })).toContainText('43 days');
    await expect(page.getByRole('row', { name: /OLD/ })).toContainText('18 days ago');

    await page.getByRole('button', { name: 'Write off Gold Standard 100% Whey batch OLD' }).click();
    const dialog = page.getByRole('dialog', { name: 'Write off Gold Standard 100% Whey?' });
    await dialog.getByLabel(/^How many/).fill('3');
    await dialog.getByRole('button', { name: 'Write off', exact: true }).click();
    await expect(page.getByText('Written off.', { exact: true })).toBeVisible();
    expect(bodyOf(api, 'POST /v1/stock/write-offs')).toEqual({
      branchId: 'br-main',
      batchId: 'b2',
      qty: 3,
    });
    expect(api.last('POST /v1/stock/write-offs')?.headers['idempotency-key']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  test('refuses a write-off quantity above what is left, without asking the server', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    api.on('GET /v1/stock/alerts', { json: ALERTS });
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await page.getByRole('button', { name: /Write off Gold Standard/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^How many/).fill('9');
    await dialog.getByRole('button', { name: 'Write off', exact: true }).click();
    await expect(dialog.getByText('4 left in this batch.').first()).toBeVisible();
    expect(api.count('POST /v1/stock/write-offs')).toBe(0);
  });
});

const TRANSFER = {
  id: 't1',
  fromBranchId: 'br-main',
  fromBranchName: 'Main branch',
  toBranchId: 'br-baner',
  toBranchName: 'Baner shop',
  status: 'IN_TRANSIT',
  note: null,
  createdAt: '2026-10-19T10:00:00.000Z',
  receivedAt: null,
  cancelledAt: null,
  lines: [{ productId: 'p-whey', productName: WHEY.name, qty: 4, batchNo: null, expiryDate: null }],
};

test.describe('transfers between branches', () => {
  test('lists transfers and lets the person receive or cancel one that is in transit', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    api.on('GET /v1/stock/transfers', {
      json: {
        items: [
          TRANSFER,
          { ...TRANSFER, id: 't2', status: 'RECEIVED', receivedAt: '2026-10-19T12:00:00.000Z' },
        ],
      },
    });
    api.on('POST /v1/stock/transfers/t1/receive', {
      json: { ...TRANSFER, status: 'RECEIVED', receivedAt: '2026-10-19T12:00:00.000Z' },
    });
    await page.getByRole('tab', { name: 'Transfers' }).click();
    const inTransit = page.getByRole('row', { name: /In transit/ });
    await expect(inTransit).toContainText('Main branch to Baner shop');
    await expect(inTransit).toContainText('1 kind of product, 4 units');
    await expect(page.getByRole('row', { name: /Received/ }).getByRole('button')).toHaveCount(0);
    await inTransit.getByRole('button', { name: 'Receive transfer from Main branch' }).click();
    await expect(page.getByText('Transfer received.', { exact: true })).toBeVisible();
  });

  test('says so when someone else already received it', async ({ page, context }) => {
    const api = await openStock(page, context);
    api.on('GET /v1/stock/transfers', { json: { items: [TRANSFER] } });
    api.on('POST /v1/stock/transfers/t1/receive', { problem: 'CONFLICT' });
    await page.getByRole('tab', { name: 'Transfers' }).click();
    await page.getByRole('button', { name: /Receive transfer/ }).click();
    await expect(
      alertOf(page).filter({ hasText: 'That was already done by someone else.' }),
    ).toBeVisible();
  });

  test('sends goods to another branch with one key, and explains when the stock is not enough', async ({
    page,
    context,
  }) => {
    const api = await openStock(page, context);
    api.on('GET /v1/stock/transfers', { json: { items: [] } });
    await page.getByRole('tab', { name: 'Transfers' }).click();
    await page.getByRole('button', { name: 'Send goods to another branch' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send goods to another branch' });
    await dialog.getByRole('combobox', { name: 'To branch' }).click();
    await page.getByRole('option', { name: 'Baner shop' }).click();
    await pickProduct(page, api, /Product, 1/, WHEY);
    await dialog.getByRole('textbox', { name: /^Qty, 1/ }).fill('4');

    api.on('POST /v1/stock/transfers', {
      problem: 'INSUFFICIENT_STOCK',
      status: 422,
      problemExtra: { detail: 'Only 2 in stock, but 4 are needed.' },
    });
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: /Only 2 in stock, but 4 are needed/ }),
    ).toBeVisible();

    api.on('POST /v1/stock/transfers', { status: 201, json: TRANSFER });
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Transfer sent.', { exact: true })).toBeVisible();
    const calls = api.calls.filter((c) => c.method === 'POST' && c.path === '/v1/stock/transfers');
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    expect(bodyOf(api, 'POST /v1/stock/transfers')).toEqual({
      fromBranchId: 'br-main',
      toBranchId: 'br-baner',
      note: null,
      lines: [{ productId: 'p-whey', qty: 4 }],
    });
  });
});

// ------------------------------------------------------------------------------------------------

const AUDIT = {
  items: [
    {
      id: 'a2',
      createdAt: '2026-10-19T11:00:00.000Z',
      action: 'stock.adjusted',
      entity: 'product',
      entityId: 'p-whey',
      actorUserId: 'u1',
      actorName: 'Ravi Mehta',
      actorRole: 'Owner',
      ipAddress: '103.21.58.14',
      userAgent: 'Chrome on Windows',
      requestId: 'r1',
      metadata: { reason: 'DAMAGE' },
      before: { qty: 21 },
      after: { qty: 18 },
    },
    {
      id: 'a1',
      createdAt: '2026-10-19T10:00:00.000Z',
      action: 'auth.login',
      entity: null,
      entityId: null,
      actorUserId: null,
      actorName: null,
      actorRole: null,
      ipAddress: null,
      userAgent: null,
      requestId: null,
      metadata: null,
      before: null,
      after: null,
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

test.describe('the audit log', () => {
  test('shows who did what with the role and the before and after, and the system for actions with no person', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('GET /v1/audit', { json: AUDIT });
    await page.goto('/audit');
    const row = page.getByRole('row', { name: /stock.adjusted/ });
    await expect(row).toContainText('Ravi Mehta (Owner)');
    await expect(row).toContainText('Before: qty: 21');
    await expect(row).toContainText('After: qty: 18');
    await expect(row).toContainText('103.21.58.14');
    await expect(page.getByRole('row', { name: /auth.login/ })).toContainText('The system');
  });

  test('sends the filters the person set, including dates as whole days in India', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('GET /v1/audit', { json: AUDIT });
    await page.goto('/audit');
    await field(page, 'Event starts with').fill('stock.');
    await field(page, 'About').fill('product');
    await field(page, 'From').fill('2026-10-01');
    await field(page, 'Until').fill('2026-10-31');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect.poll(() => api.last('GET /v1/audit')?.search).toContain('action=stock.');
    const search = new URLSearchParams(api.last('GET /v1/audit')!.search);
    expect(search.get('entity')).toBe('product');
    expect(search.get('from')).toBe('2026-09-30T18:30:00.000Z');
    expect(search.get('to')).toBe('2026-10-31T18:29:59.999Z');
    // Clearing empties the boxes (the unfiltered list is already cached, so it may not ask the server again).
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(field(page, 'Event starts with')).toHaveValue('');
    await expect(field(page, 'About')).toHaveValue('');
  });

  test('says plainly whether the log is intact, or where it first breaks', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('GET /v1/audit', { json: AUDIT });
    api.on('GET /v1/audit/verify', {
      json: { ok: true, sealed: 420, unsealed: 0, firstBrokenSeq: null, problem: null },
    });
    await page.goto('/audit');
    await page.getByRole('button', { name: 'Check for tampering' }).click();
    await expect(
      page.getByText('The log is intact: all 420 entries match their seals.'),
    ).toBeVisible();

    api.on('GET /v1/audit/verify', {
      json: {
        ok: false,
        sealed: 420,
        unsealed: 0,
        firstBrokenSeq: 17,
        problem: 'A sealed audit entry has been changed.',
      },
    });
    await page.getByRole('button', { name: 'Check for tampering' }).click();
    await expect(
      alertOf(page).filter({
        hasText: 'The first seal that fails is number 17: A sealed audit entry has been changed.',
      }),
    ).toBeVisible();
  });
});

test.describe('the first-steps checklist', () => {
  test('has supplier and purchase steps that link to where they are done', async ({
    page,
    context,
  }) => {
    const api = await start(page, context);
    api.on('GET /v1/business/onboarding', {
      json: {
        steps: [
          { key: 'PROFILE', done: true },
          { key: 'BRANCH', done: true },
          { key: 'PRODUCTS', done: true },
          { key: 'SUPPLIER', done: false },
          { key: 'PURCHASE', done: false },
          { key: 'TEAM', done: false },
        ],
        gstinMissing: false,
      },
    });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Add a supplier' })).toHaveAttribute(
      'href',
      '/suppliers',
    );
    await expect(page.getByRole('link', { name: 'Record a purchase' })).toHaveAttribute(
      'href',
      '/purchases/new',
    );
    await expect(page.getByText('3 of 6 done')).toBeVisible();
  });
});

// ------------------------------------------------------------------------------------------------

/** Every new screen, in both themes, must pass the automatic accessibility check. */
for (const theme of THEMES) {
  const screens: Array<{
    name: string;
    path: string;
    heading: string;
    prepare: (api: MockApi) => void;
    after?: (page: Page, api: MockApi) => Promise<void>;
  }> = [
    { name: 'suppliers', path: '/suppliers', heading: 'Suppliers', prepare: () => undefined },
    {
      name: 'purchases',
      path: '/purchases',
      heading: 'Purchases',
      prepare: (api) =>
        api.on('GET /v1/purchases', {
          json: {
            items: [
              {
                id: 'pu-1',
                invoiceRef: 'NDP/2410/0417',
                invoiceDate: '2026-10-19',
                supplierName: NUTRI.name,
                branchName: 'Main branch',
                lineCount: 2,
                totalPaise: 440_000,
                createdAt: '2026-10-19T10:00:00.000Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
        }),
    },
    {
      name: 'purchase detail',
      path: '/purchases/pu-1',
      heading: 'Purchases',
      prepare: (api) => api.on('GET /v1/purchases/pu-1', { json: PURCHASE }),
      after: async (page) => {
        await expect(page.getByText('Total owed')).toBeVisible();
      },
    },
    {
      name: 'new purchase',
      path: '/purchases/new',
      heading: 'Record a purchase',
      prepare: (api) =>
        api.on('GET /v1/stock', {
          json: { branchId: 'br-main', items: [], total: 0, limit: 10, offset: 0 },
        }),
      after: async (page, api) => {
        await pick(page, 'Supplier', /Nutri Distributors/);
        await pick(page, 'Branch', /Main branch/);
        await pickProduct(page, api, /Product, Line 1/, WHEY);
        await page.getByRole('textbox', { name: /^Qty, Line 1/ }).fill('10');
        await page.getByRole('textbox', { name: /^Unit cost, Line 1/ }).fill('100');
        await page.getByRole('button', { name: 'Save purchase' }).click();
        await expect(alertOf(page).first()).toBeVisible();
      },
    },
    {
      name: 'debit notes',
      path: '/purchases/returns',
      heading: 'Debit notes',
      prepare: (api) => api.on('GET /v1/supplier-returns', { json: { items: [] } }),
    },
    {
      name: 'stock',
      path: '/stock',
      heading: 'Stock',
      prepare: (api) => api.on('GET /v1/stock', STOCK_LIST([STOCK_ROW({ qty: 2, isLow: true })])),
      after: async (page) => {
        await expect(page.getByRole('cell', { name: /^Gold Standard/ })).toBeVisible();
      },
    },
    {
      name: 'stock history',
      path: '/stock',
      heading: 'Stock',
      prepare: (api) => {
        api.on('GET /v1/stock', STOCK_LIST([STOCK_ROW()]));
        api.on('GET /v1/stock/ledger', { json: LEDGER });
      },
      after: async (page) => {
        await page.getByRole('button', { name: 'History of Gold Standard 100% Whey' }).click();
        await expect(page.getByRole('dialog').getByRole('row', { name: /Purchase/ })).toBeVisible();
      },
    },
    {
      name: 'count dialog',
      path: '/stock',
      heading: 'Stock',
      prepare: (api) => api.on('GET /v1/stock', STOCK_LIST([STOCK_ROW()])),
      after: async (page) => {
        await page.getByRole('button', { name: 'Count Gold Standard 100% Whey' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
      },
    },
    {
      name: 'stock alerts',
      path: '/stock',
      heading: 'Stock',
      prepare: (api) => {
        api.on('GET /v1/stock', STOCK_LIST([STOCK_ROW()]));
        api.on('GET /v1/stock/alerts', { json: ALERTS });
      },
      after: async (page) => {
        await page.getByRole('tab', { name: 'Alerts' }).click();
        await expect(page.getByRole('row', { name: /OLD/ })).toBeVisible();
      },
    },
    {
      name: 'stock transfers',
      path: '/stock',
      heading: 'Stock',
      prepare: (api) => {
        api.on('GET /v1/stock', STOCK_LIST([STOCK_ROW()]));
        api.on('GET /v1/stock/transfers', { json: { items: [TRANSFER] } });
      },
      after: async (page) => {
        await page.getByRole('tab', { name: 'Transfers' }).click();
        await expect(page.getByRole('row', { name: /In transit/ })).toBeVisible();
      },
    },
    {
      name: 'audit log',
      path: '/audit',
      heading: 'Audit log',
      prepare: (api) => {
        api.on('GET /v1/audit', { json: AUDIT });
        api.on('GET /v1/audit/verify', {
          json: { ok: true, sealed: 2, unsealed: 0, firstBrokenSeq: null, problem: null },
        });
      },
      after: async (page) => {
        await page.getByRole('button', { name: 'Check for tampering' }).click();
        await expect(page.getByText(/The log is intact/)).toBeVisible();
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
      const api = await start(page, context);
      api.on('GET /v1/stock', {
        json: { branchId: 'br-main', items: [], total: 0, limit: 10, offset: 0 },
      });
      screen.prepare(api);
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible();
      await expect(page.locator('main#main [role="status"][aria-label^="Loading"]')).toHaveCount(0);
      await screen.after?.(page, api);
      await page.screenshot({
        path: `test-results/screens/inventory-${screen.name.replace(/[^a-z]+/g, '-')}-${theme}.png`,
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
