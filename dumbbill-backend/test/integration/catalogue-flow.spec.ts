import sharp from 'sharp';
import { createApiDocument } from '../../src/swagger';
import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import { addTeamMember, as, createBusiness, Person } from '../support/team-helpers';

/**
 * Products, categories, prices with history, pictures and CSV import, end to end against the real application and a
 * real PostgreSQL database with row-level security. Each scenario is something an owner, an admin, a cashier or an
 * outsider could really do. Includes the CASHIER-LEAK SCANNER: every product response a cashier can get is searched for
 * anything that looks like cost, margin or profit.
 */
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp();
});

afterAll(async () => {
  await t.close();
});

const COST = 123_457; // distinctive, so a leak into logs or audit rows is easy to spot

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Gold Standard 100% Whey',
    brand: 'Optimum Nutrition',
    variant: '2 kg / Chocolate',
    sku: 'ON-GS-2KG-CHOC',
    barcode: '748927052145',
    hsn: '21069099',
    gstRateBp: 1800,
    mrpPaise: 349_900,
    pricePaise: 299_900,
    ...overrides,
  };
}

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await t.db.owner.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.action);
}

/** A business with its owner, an admin (everything catalogue-related) and a cashier (read only). */
async function shop() {
  const owner = await createBusiness(t);
  const admin = await addTeamMember(t, owner, 'ADMIN');
  const cashier = await addTeamMember(t, owner, 'CASHIER');
  return { owner, admin, cashier };
}

async function createProduct(person: Person, overrides: Record<string, unknown> = {}) {
  const res = await as(t, person).post('/v1/products', body(overrides));
  if (res.status !== 201)
    throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string };
}

/** Upload a file as a multipart form field named `file`. */
function upload(
  person: Person,
  method: 'put' | 'post',
  path: string,
  data: Buffer,
  filename: string,
  contentType: string,
) {
  return t
    .http()
    [method](path)
    .set('Authorization', `Bearer ${person.accessToken}`)
    .set('X-Forwarded-For', t.freshIp())
    .attach('file', data, { filename, contentType });
}

const picture = (width: number, height: number, format: 'png' | 'jpeg' | 'gif' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#0f5c5c' } })
    [format]()
    .toBuffer();

describe('a new business', () => {
  it('starts with the starter categories, and the form options say which GST rates exist', async () => {
    const { owner } = await shop();
    const res = await as(t, owner).get('/v1/products/options');
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(['Protein & whey']),
    );
    expect(res.body.gstRatesBp).toEqual([0, 25, 300, 500, 1800, 4000]);
    expect(res.body.taxDetailsRequired).toBe(false);
  });

  it('lets someone with products.write add a category, and refuses a repeated name (ignoring case)', async () => {
    const { admin } = await shop();
    const made = await as(t, admin).post('/v1/products/categories', {
      name: 'Pre-workout',
      defaultGstRateBp: 1800,
    });
    expect(made.status).toBe(201);
    const again = await as(t, admin).post('/v1/products/categories', { name: 'pre-WORKOUT' });
    expect(again.status).toBe(409);
    expect(again.body.errors[0].field).toBe('name');
    const badRate = await as(t, admin).post('/v1/products/categories', {
      name: 'Odd',
      defaultGstRateBp: 1200,
    });
    expect(badRate.status).toBe(400);
  });
});

describe('creating and reading products', () => {
  it('creates a product with its first price, and reads it back with the price in force', async () => {
    const { admin } = await shop();
    const made = await as(t, admin).post('/v1/products', body({ purchaseCostPaise: COST }));
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      name: 'Gold Standard 100% Whey',
      variant: '2 kg / Chocolate',
      barcode: '748927052145',
      mrpPaise: 349_900,
      pricePaise: 299_900,
      isActive: true,
      hasImage: false,
    });
    const read = await as(t, admin).get(`/v1/products/${made.body.id}`);
    expect(read.body.pricePaise).toBe(299_900);
    const history = await as(t, admin).get(`/v1/products/${made.body.id}/prices`);
    expect(history.body.prices).toHaveLength(1);
    expect(history.body.prices[0]).toMatchObject({
      reason: 'Initial price',
      current: true,
      scheduled: false,
    });
  });

  it('searches in name, brand, variant, SKU and barcode, filters by category, and pages', async () => {
    const { admin } = await shop();
    const options = (await as(t, admin).get('/v1/products/options')).body;
    const protein = options.categories.find((c: { name: string }) => c.name === 'Protein & whey');
    await createProduct(admin, { categoryId: protein.id });
    await createProduct(admin, {
      name: 'Creatine Monohydrate',
      brand: 'MuscleBlaze',
      variant: '250 g',
      sku: 'MB-CR-250',
      barcode: '8904000111',
    });
    await createProduct(admin, {
      name: 'Shaker',
      brand: 'Dumbbill',
      variant: '',
      sku: 'SH-1',
      barcode: 'SHAKER001',
    });

    const byName = await as(t, admin).get('/v1/products?q=creatine');
    expect(byName.body.items.map((p: { name: string }) => p.name)).toEqual([
      'Creatine Monohydrate',
    ]);
    expect((await as(t, admin).get('/v1/products?q=748927')).body.total).toBe(1);
    expect((await as(t, admin).get('/v1/products?q=mb-cr')).body.total).toBe(1);
    expect((await as(t, admin).get('/v1/products?q=muscleblaze')).body.total).toBe(1);
    expect((await as(t, admin).get(`/v1/products?categoryId=${protein.id}`)).body.total).toBe(1);
    const page = await as(t, admin).get('/v1/products?limit=2&offset=1');
    expect(page.body).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(page.body.items).toHaveLength(2);
    expect((await as(t, admin).get('/v1/products?limit=500')).status).toBe(400);
  });

  it('finds an active product by barcode (the till scans it) and answers 404 for an unknown or switched-off one', async () => {
    const { admin, cashier } = await shop();
    const made = await createProduct(admin);
    const found = await as(t, cashier).get('/v1/products/by-barcode/748927052145');
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(made.id);
    expect((await as(t, cashier).get('/v1/products/by-barcode/000000')).status).toBe(404);
    await as(t, admin).post(`/v1/products/${made.id}/deactivate`);
    expect((await as(t, cashier).get('/v1/products/by-barcode/748927052145')).status).toBe(404);
  });

  it('hides switched-off products by default and shows them on request, and switching on again restores it', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    const off = await as(t, admin).post(`/v1/products/${made.id}/deactivate`);
    expect(off.body.isActive).toBe(false);
    expect((await as(t, admin).get('/v1/products')).body.total).toBe(0);
    expect((await as(t, admin).get('/v1/products?status=inactive')).body.total).toBe(1);
    expect((await as(t, admin).get('/v1/products?status=all')).body.total).toBe(1);
    const on = await as(t, admin).post(`/v1/products/${made.id}/activate`);
    expect(on.body.isActive).toBe(true);
    expect(await auditActions(admin.tenantId)).toEqual(
      expect.arrayContaining(['product.created', 'product.deactivated', 'product.activated']),
    );
  });

  it('edits the descriptive fields and audits the field NAMES that changed', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    const res = await as(t, admin).put(`/v1/products/${made.id}`, {
      name: 'Gold Standard 100% Whey',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Vanilla',
      sku: 'ON-GS-2KG-CHOC',
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
    });
    expect(res.status).toBe(200);
    expect(res.body.variant).toBe('2 kg / Vanilla');
    const audit = await t.db.owner.auditLog.findFirstOrThrow({
      where: { tenantId: admin.tenantId, action: 'product.updated' },
    });
    expect(audit.metadata).toEqual({ changedFields: 'variant' });
  });
});

describe('what must be unique, and what the tax rules demand', () => {
  it('refuses a repeated barcode, SKU, or name + brand + variant, naming the field', async () => {
    const { admin } = await shop();
    await createProduct(admin);
    const barcode = await as(t, admin).post('/v1/products', body({ name: 'Other', sku: 'X1' }));
    expect(barcode.status).toBe(409);
    expect(barcode.body.errors.map((e: { field: string }) => e.field)).toEqual(['barcode']);
    const sku = await as(t, admin).post('/v1/products', body({ name: 'Other', barcode: '999111' }));
    expect(sku.body.errors.map((e: { field: string }) => e.field)).toEqual(['sku']);
    const same = await as(t, admin).post(
      '/v1/products',
      body({ name: 'GOLD standard 100% whey', sku: 'X2', barcode: '999222' }),
    );
    expect(same.body.errors.map((e: { field: string }) => e.field)).toEqual(['name']);
  });

  it('allows the same variant name under another brand, and the same barcode in another business', async () => {
    const { admin } = await shop();
    const other = await shop();
    await createProduct(admin);
    expect(
      (
        await as(t, admin).post(
          '/v1/products',
          body({ brand: 'MuscleBlaze', sku: 'MB', barcode: '5551234' }),
        )
      ).status,
    ).toBe(201);
    expect((await as(t, other.admin).post('/v1/products', body())).status).toBe(201);
  });

  it('lets a product keep its own barcode when it is edited (no clash with itself)', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    const res = await as(t, admin).put(`/v1/products/${made.id}`, {
      name: 'Gold Standard 100% Whey',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Chocolate',
      sku: 'ON-GS-2KG-CHOC',
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
    });
    expect(res.status).toBe(200);
  });

  it('requires HSN and GST rate once the business has a GSTIN, and not before', async () => {
    const { owner, admin } = await shop();
    const bare = { hsn: null, gstRateBp: null };
    expect((await as(t, admin).post('/v1/products', body(bare))).status).toBe(201);

    await t.db.owner.tenant.update({
      where: { id: owner.tenantId },
      data: { stateCode: '27', gstin: '27AAPFU0939F1ZV' },
    });
    const refused = await as(t, admin).post(
      '/v1/products',
      body({ ...bare, name: 'Another', sku: 'A2', barcode: '777888' }),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
      'gstRateBp',
      'hsn',
    ]);
    expect((await as(t, owner).get('/v1/products/options')).body.taxDetailsRequired).toBe(true);
  });

  it('refuses a GST rate that is not a real slab, a malformed HSN or barcode, and an unknown category', async () => {
    const { admin } = await shop();
    const res = await as(t, admin).post(
      '/v1/products',
      body({
        gstRateBp: 1200,
        hsn: '210',
        barcode: 'a b',
        categoryId: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(
      ['barcode', 'categoryId', 'gstRateBp', 'hsn'].sort(),
    );
  });

  it('rejects fields a client must never set', async () => {
    const { admin } = await shop();
    const res = await as(t, admin).post(
      '/v1/products',
      body({ tenantId: 'x', imageKey: 'y', isActive: false }),
    );
    expect(res.status).toBe(400);
  });
});

describe('prices and their history', () => {
  it('refuses a selling price above the MRP and prices that are not whole positive paise', async () => {
    const { admin } = await shop();
    expect((await as(t, admin).post('/v1/products', body({ pricePaise: 400_000 }))).status).toBe(
      400,
    );
    expect((await as(t, admin).post('/v1/products', body({ pricePaise: 99.5 }))).status).toBe(400);
    expect((await as(t, admin).post('/v1/products', body({ mrpPaise: 0 }))).status).toBe(400);
  });

  it('records each change with who and why, and the newest started price is the one in force', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    const changed = await as(t, admin).post(`/v1/products/${made.id}/prices`, {
      mrpPaise: 349_900,
      pricePaise: 279_900,
      reason: 'Diwali offer',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.pricePaise).toBe(279_900);

    const history = (await as(t, admin).get(`/v1/products/${made.id}/prices`)).body.prices;
    expect(history.map((p: { pricePaise: number }) => p.pricePaise)).toEqual([279_900, 299_900]);
    expect(history[0]).toMatchObject({
      reason: 'Diwali offer',
      current: true,
      changedByName: 'admin person',
    });
    expect(history[1].current).toBe(false);
    expect(await auditActions(admin.tenantId)).toContain('product.price_changed');
  });

  it('needs a reason, refuses a price above the MRP, and refuses to "change" to the price already in force', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    const path = `/v1/products/${made.id}/prices`;
    expect((await as(t, admin).post(path, { mrpPaise: 349_900, pricePaise: 289_900 })).status).toBe(
      400,
    );
    expect(
      (await as(t, admin).post(path, { mrpPaise: 349_900, pricePaise: 289_900, reason: 'x' }))
        .status,
    ).toBe(400);
    const above = await as(t, admin).post(path, {
      mrpPaise: 349_900,
      pricePaise: 400_000,
      reason: 'typo',
    });
    expect(above.status).toBe(400);
    expect(above.body.errors[0].field).toBe('pricePaise');
    const same = await as(t, admin).post(path, {
      mrpPaise: 349_900,
      pricePaise: 299_900,
      reason: 'no change',
    });
    expect(same.status).toBe(422);
  });

  it('schedules a future price that takes over only when its time comes, and refuses a start in the past', async () => {
    const { admin, cashier } = await shop();
    const made = await createProduct(admin);
    const start = new Date(t.clock.now().getTime() + 5 * 60_000).toISOString();
    const scheduled = await as(t, admin).post(`/v1/products/${made.id}/prices`, {
      mrpPaise: 349_900,
      pricePaise: 259_900,
      reason: 'New year sale',
      effectiveFrom: start,
    });
    expect(scheduled.status).toBe(200);
    // Tomorrow's price must not apply today, for anyone.
    expect(scheduled.body.pricePaise).toBe(299_900);
    expect((await as(t, cashier).get(`/v1/products/${made.id}`)).body.pricePaise).toBe(299_900);
    const before = (await as(t, admin).get(`/v1/products/${made.id}/prices`)).body.prices;
    expect(before[0]).toMatchObject({ scheduled: true, current: false });
    expect(before[1]).toMatchObject({ current: true });

    // Move 6 minutes on (an access token lives 15 minutes, so the same sign-in keeps working).
    t.clock.advanceSeconds(6 * 60);
    expect((await as(t, cashier).get(`/v1/products/${made.id}`)).body.pricePaise).toBe(259_900);
    const after = (await as(t, admin).get(`/v1/products/${made.id}/prices`)).body.prices;
    expect(after[0]).toMatchObject({ scheduled: false, current: true });

    const past = new Date(t.clock.now().getTime() - 10 * 60_000).toISOString();
    const refused = await as(t, admin).post(`/v1/products/${made.id}/prices`, {
      mrpPaise: 349_900,
      pricePaise: 200_000,
      reason: 'backdate',
      effectiveFrom: past,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.errors[0].field).toBe('effectiveFrom');
  });

  it('keeps editing a product from changing its price (the history is only ever added to)', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    await as(t, admin).put(`/v1/products/${made.id}`, {
      name: 'Renamed whey',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Chocolate',
      sku: 'ON-GS-2KG-CHOC',
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
    });
    const history = (await as(t, admin).get(`/v1/products/${made.id}/prices`)).body.prices;
    expect(history).toHaveLength(1);
    expect(history[0].pricePaise).toBe(299_900);
  });
});

describe('who may do what', () => {
  it('lets a cashier read products but not create, change, switch off, price, upload or import', async () => {
    const { admin, cashier } = await shop();
    const made = await createProduct(admin);
    expect((await as(t, cashier).get('/v1/products')).status).toBe(200);
    expect((await as(t, cashier).get(`/v1/products/${made.id}`)).status).toBe(200);
    expect((await as(t, cashier).get('/v1/products/options')).status).toBe(200);
    expect(
      (
        await as(t, cashier).post(
          '/v1/products',
          body({ name: 'Nope', sku: 'N', barcode: '111222' }),
        )
      ).status,
    ).toBe(403);
    expect((await as(t, cashier).put(`/v1/products/${made.id}`, body())).status).toBe(403);
    expect((await as(t, cashier).post(`/v1/products/${made.id}/deactivate`)).status).toBe(403);
    expect((await as(t, cashier).get(`/v1/products/${made.id}/prices`)).status).toBe(403);
    expect(
      (
        await as(t, cashier).post(`/v1/products/${made.id}/prices`, {
          mrpPaise: 1,
          pricePaise: 1,
          reason: 'abc',
        })
      ).status,
    ).toBe(403);
    expect((await as(t, cashier).post('/v1/products/categories', { name: 'Nope' })).status).toBe(
      403,
    );
    expect(
      (
        await upload(
          cashier,
          'put',
          `/v1/products/${made.id}/image`,
          await picture(10, 10),
          'a.png',
          'image/png',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await upload(
          cashier,
          'post',
          '/v1/products/import',
          Buffer.from('name,mrp,price\nX,1,1'),
          'a.csv',
          'text/csv',
        )
      ).status,
    ).toBe(403);
  });

  it('separates products.write from pricing.write: creating a product needs both, changing details needs only write', async () => {
    const { owner, admin } = await shop();
    const made = await createProduct(admin);
    const writerOnly = await addTeamMember(
      t,
      owner,
      'ADMIN',
      { deniedPermissions: ['pricing.write'] },
      'writer',
    );
    expect(
      (
        await as(t, writerOnly).post(
          '/v1/products',
          body({ name: 'X2', sku: 'X2', barcode: '4443332' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await as(t, writerOnly).post(`/v1/products/${made.id}/prices`, {
          mrpPaise: 349_900,
          pricePaise: 250_000,
          reason: 'try',
        })
      ).status,
    ).toBe(403);
    const edit = await as(t, writerOnly).put(`/v1/products/${made.id}`, {
      name: 'Renamed',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Chocolate',
      sku: 'ON-GS-2KG-CHOC',
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
    });
    expect(edit.status).toBe(200);
  });

  it("answers 404 for another business's product on every product route", async () => {
    const mine = await shop();
    const theirs = await shop();
    const made = await createProduct(theirs.admin);
    const id = made.id;
    const asMine = as(t, mine.admin);
    expect((await asMine.get(`/v1/products/${id}`)).status).toBe(404);
    expect(
      (
        await asMine.put(`/v1/products/${id}`, {
          name: 'Gold Standard 100% Whey',
          brand: 'Optimum Nutrition',
          variant: '2 kg / Chocolate',
        })
      ).status,
    ).toBe(404);
    expect((await asMine.post(`/v1/products/${id}/deactivate`)).status).toBe(404);
    expect((await asMine.post(`/v1/products/${id}/activate`)).status).toBe(404);
    expect((await asMine.get(`/v1/products/${id}/prices`)).status).toBe(404);
    expect(
      (
        await asMine.post(`/v1/products/${id}/prices`, {
          mrpPaise: 349_900,
          pricePaise: 250_000,
          reason: 'try',
        })
      ).status,
    ).toBe(404);
    expect((await asMine.get(`/v1/products/${id}/image`)).status).toBe(404);
    expect((await asMine.delete(`/v1/products/${id}/image`)).status).toBe(404);
    expect(
      (
        await upload(
          mine.admin,
          'put',
          `/v1/products/${id}/image`,
          await picture(10, 10),
          'a.png',
          'image/png',
        )
      ).status,
    ).toBe(404);
    expect((await asMine.get('/v1/products')).body.total).toBe(0);
    expect((await asMine.get('/v1/products/by-barcode/748927052145')).status).toBe(404);
  });
});

/** Any key that smells like cost, margin or profit. Matched against every key of every nested object. */
const COST_LIKE_KEY = /cost|margin|profit|wac|purchase|landed|cogs/i;

function costLikeKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => costLikeKeys(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [
      ...(COST_LIKE_KEY.test(key) ? [`${path}.${key}`] : []),
      ...costLikeKeys(inner, `${path}.${key}`),
    ]);
  }
  return [];
}

describe('the cashier-leak scanner (cost secrecy, hard rule 3)', () => {
  it('shows a cashier NO cost, margin or profit on any product response, while an admin sees them', async () => {
    const { admin, cashier } = await shop();
    const made = await createProduct(admin, { purchaseCostPaise: COST });
    await createProduct(admin, {
      name: 'Shaker',
      brand: 'Dumbbill',
      variant: '',
      sku: 'SH-1',
      barcode: 'SHAKER001',
      purchaseCostPaise: COST,
    });

    const cashierResponses = [
      await as(t, cashier).get('/v1/products'),
      await as(t, cashier).get('/v1/products?q=whey&status=all'),
      await as(t, cashier).get(`/v1/products/${made.id}`),
      await as(t, cashier).get('/v1/products/by-barcode/748927052145'),
      await as(t, cashier).get('/v1/products/options'),
    ];
    for (const res of cashierResponses) {
      expect(res.status).toBe(200);
      expect(costLikeKeys(res.body)).toEqual([]);
      // Not even the VALUE may appear anywhere in the text.
      expect(JSON.stringify(res.body)).not.toContain(String(COST));
    }

    const adminList = await as(t, admin).get('/v1/products');
    expect(adminList.body.items[0]).toMatchObject({ purchaseCostPaise: COST, belowCost: false });
    expect(adminList.body.items[0].marginBp).toBe(
      Math.round(((299_900 - COST) * 10_000) / 299_900),
    );
  });

  it('applies to a person who has products.write but NOT products.cost.read (not just the cashier role)', async () => {
    const { owner, admin } = await shop();
    const noCost = await addTeamMember(
      t,
      owner,
      'ADMIN',
      { deniedPermissions: ['products.cost.read'] },
      'nocost',
    );
    const made = await createProduct(admin, { purchaseCostPaise: COST });
    const read = await as(t, noCost).get(`/v1/products/${made.id}`);
    expect(costLikeKeys(read.body)).toEqual([]);
    // They may edit the product, and the edit leaves the cost alone.
    const edit = await as(t, noCost).put(`/v1/products/${made.id}`, {
      name: 'Gold Standard 100% Whey',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Chocolate',
      sku: 'ON-GS-2KG-CHOC',
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
    });
    expect(edit.status).toBe(200);
    expect(costLikeKeys(edit.body)).toEqual([]);
    expect((await as(t, admin).get(`/v1/products/${made.id}`)).body.purchaseCostPaise).toBe(COST);
    // Sending a cost is refused outright.
    const send = await as(t, noCost).put(`/v1/products/${made.id}`, {
      name: 'Gold Standard 100% Whey',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Chocolate',
      sku: 'ON-GS-2KG-CHOC',
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
      purchaseCostPaise: 1,
    });
    expect(send.status).toBe(403);
    const create = await as(t, noCost).post(
      '/v1/products',
      body({ name: 'New', sku: 'NEW', barcode: '5559991', purchaseCostPaise: 1 }),
    );
    expect(create.status).toBe(403);
    // The price-change answer is shaped the same way.
    const price = await as(t, noCost).post(`/v1/products/${made.id}/prices`, {
      mrpPaise: 349_900,
      pricePaise: 270_000,
      reason: 'sale',
    });
    expect(price.status).toBe(200);
    expect(costLikeKeys(price.body)).toEqual([]);
  });

  it('keeps the cost out of the audit log (field names only) and flags a price below cost to admins only', async () => {
    const { admin, cashier } = await shop();
    const made = await createProduct(admin, { purchaseCostPaise: COST });
    await as(t, admin).put(`/v1/products/${made.id}`, {
      name: 'Gold Standard 100% Whey',
      brand: 'Optimum Nutrition',
      variant: '2 kg / Chocolate',
      sku: 'ON-GS-2KG-CHOC',
      barcode: '748927052145',
      hsn: '21069099',
      gstRateBp: 1800,
      purchaseCostPaise: COST + 1,
    });
    const rows = await t.db.owner.auditLog.findMany({ where: { tenantId: admin.tenantId } });
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain(String(COST));

    const below = await as(t, admin).post(`/v1/products/${made.id}/prices`, {
      mrpPaise: 349_900,
      pricePaise: 100_000,
      reason: 'clearance',
    });
    expect(below.body.belowCost).toBe(true);
    expect(costLikeKeys((await as(t, cashier).get(`/v1/products/${made.id}`)).body)).toEqual([]);
  });

  it('documents the cashier type without any cost field (the written contract itself)', () => {
    const schemas = createApiDocument(t.app).components?.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    expect(Object.keys(schemas.ProductCashierDto!.properties)).not.toEqual([]);
    expect(costLikeKeys(schemas.ProductCashierDto!.properties)).toEqual([]);
    expect(costLikeKeys(schemas.ProductAdminDto!.properties).length).toBeGreaterThan(0);
  });
});

describe('pictures', () => {
  it('stores a clean 800 px WebP and a 160 px thumbnail, and shows them to everyone who can read products', async () => {
    const { admin, cashier } = await shop();
    const made = await createProduct(admin);
    const saved = await upload(
      admin,
      'put',
      `/v1/products/${made.id}/image`,
      await picture(1600, 1000),
      'photo.png',
      'image/png',
    );
    expect(saved.status).toBe(200);
    expect(saved.body.hasImage).toBe(true);

    const download = async (size: string) => {
      const res = await t
        .http()
        .get(`/v1/products/${made.id}/image?size=${size}`)
        .set('Authorization', `Bearer ${cashier.accessToken}`)
        .set('X-Forwarded-For', t.freshIp())
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        });
      return res;
    };
    const full = await download('full');
    expect(full.headers['content-type']).toBe('image/webp');
    expect(full.headers['cache-control']).toContain('private');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    const fullInfo = await sharp(full.body as Buffer).metadata();
    expect([fullInfo.format, fullInfo.width, fullInfo.height]).toEqual(['webp', 800, 500]);
    const thumbInfo = await sharp((await download('thumb')).body as Buffer).metadata();
    expect([thumbInfo.width, thumbInfo.height]).toEqual([160, 100]);
    expect(await auditActions(admin.tenantId)).toContain('product.image_changed');
  });

  it('refuses text renamed to .png, a GIF, an empty file and a file over 2 MB, and leaves the product without a picture', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    const path = `/v1/products/${made.id}/image`;
    const fake = await upload(
      admin,
      'put',
      path,
      Buffer.from('<script>alert(1)</script>'),
      'a.png',
      'image/png',
    );
    expect(fake.status).toBe(422);
    expect(fake.body.code).toBe('FILE_CONTENT_MISMATCH');
    const gif = await upload(
      admin,
      'put',
      path,
      await picture(10, 10, 'gif'),
      'a.gif',
      'image/gif',
    );
    expect(gif.status).toBe(415);
    const big = await upload(
      admin,
      'put',
      path,
      Buffer.concat([await picture(10, 10), Buffer.alloc(2 * 1024 * 1024)]),
      'big.png',
      'image/png',
    );
    expect(big.status).toBe(413);
    const none = await t
      .http()
      .put(path)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('X-Forwarded-For', t.freshIp())
      .field('x', 'y');
    expect(none.status).toBe(400);
    expect((await as(t, admin).get(`/v1/products/${made.id}`)).body.hasImage).toBe(false);
    expect((await as(t, admin).get(path)).status).toBe(404);
  });

  it('replaces and removes a picture (removing twice is fine)', async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    const path = `/v1/products/${made.id}/image`;
    await upload(admin, 'put', path, await picture(300, 300), 'a.png', 'image/png');
    const first = await t.db.owner.product.findUniqueOrThrow({ where: { id: made.id } });
    await upload(admin, 'put', path, await picture(300, 300, 'jpeg'), 'a.jpg', 'image/jpeg');
    const second = await t.db.owner.product.findUniqueOrThrow({ where: { id: made.id } });
    expect(second.imageKey).not.toBe(first.imageKey);
    expect((await as(t, admin).delete(path)).status).toBe(204);
    expect((await as(t, admin).delete(path)).status).toBe(204);
    expect((await as(t, admin).get(path)).status).toBe(404);
  });

  it("keeps each business's pictures under its own folder, with random names", async () => {
    const { admin } = await shop();
    const made = await createProduct(admin);
    await upload(
      admin,
      'put',
      `/v1/products/${made.id}/image`,
      await picture(50, 50),
      'My Secret Name.png',
      'image/png',
    );
    const row = await t.db.owner.product.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.imageKey).toMatch(
      new RegExp(`^${admin.tenantId}/product-images/[0-9a-f-]{36}\\.webp$`),
    );
    expect(row.imageKey).not.toContain('Secret');
  });
});

describe('CSV import', () => {
  const HEADER = 'name,brand,category,variant,sku,barcode,hsn,gst_percent,mrp,price,cost';
  const csv = (...rows: string[]) => Buffer.from([HEADER, ...rows].join('\r\n'));
  const importFile = (person: Person, data: Buffer, query = '') =>
    upload(person, 'post', `/v1/products/import${query}`, data, 'products.csv', 'text/csv');

  it('checks a file without saving it (dry run), then imports the good rows and reports each bad one', async () => {
    const { admin } = await shop();
    const file = csv(
      'Whey Isolate,ON,Protein & whey,1 kg,S1,111111,21069099,18,"4,499",3999,3000',
      'Creatine,MB,Brand new category,250 g,S2,222222,,18,1299,999,',
      'Broken,,,,S3,333333,,,abc,100,',
      'Dearer,,,,S4,444444,,,100,150,',
    );
    const dry = await importFile(admin, file, '?dryRun=true');
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({
      dryRun: true,
      totalRows: 4,
      createdCount: 2,
      failedCount: 2,
      categoriesCreated: ['Brand new category'],
    });
    expect((await as(t, admin).get('/v1/products?status=all')).body.total).toBe(0);

    const real = await importFile(admin, file);
    expect(real.body).toMatchObject({ dryRun: false, createdCount: 2, failedCount: 2 });
    expect(real.body.failedRows.map((r: { rowNumber: number }) => r.rowNumber)).toEqual([4, 5]);
    expect(real.body.failedRows[0].errors[0].field).toBe('mrp');
    expect(real.body.failedRows[1].errors[0].field).toBe('price');

    const list = (await as(t, admin).get('/v1/products')).body.items;
    const whey = list.find((p: { name: string }) => p.name === 'Whey Isolate');
    expect(whey).toMatchObject({
      mrpPaise: 449_900,
      pricePaise: 399_900,
      purchaseCostPaise: 300_000,
      gstRateBp: 1800,
      categoryName: 'Protein & whey',
    });
    expect(list.find((p: { name: string }) => p.name === 'Creatine').categoryName).toBe(
      'Brand new category',
    );
    const history = (await as(t, admin).get(`/v1/products/${whey.id}/prices`)).body.prices;
    expect(history[0].reason).toBe('Initial price (CSV import)');
    expect(await auditActions(admin.tenantId)).toContain('product.imported');
  });

  it('refuses rows that clash with products already in the catalogue, and a second import of the same file creates nothing', async () => {
    const { admin } = await shop();
    const file = csv('Whey,ON,,1 kg,S1,111111,,,1000,900,');
    expect((await importFile(admin, file)).body.createdCount).toBe(1);
    const again = await importFile(admin, file);
    expect(again.body.createdCount).toBe(0);
    expect(again.body.failedRows[0].errors.map((e: { field: string }) => e.field).sort()).toEqual([
      'barcode',
      'name',
      'sku',
    ]);
  });

  it('refuses the same barcode twice inside one file (the later row fails)', async () => {
    const { admin } = await shop();
    const res = await importFile(admin, csv('Aa,,,,,111,,,10,9,', 'Bb,,,,,111,,,10,9,'));
    expect(res.body).toMatchObject({ createdCount: 1, failedCount: 1 });
    expect(res.body.failedRows[0]).toMatchObject({ rowNumber: 3 });
  });

  it('requires HSN and GST rate on each row once the business has a GSTIN', async () => {
    const { owner, admin } = await shop();
    await t.db.owner.tenant.update({
      where: { id: owner.tenantId },
      data: { stateCode: '27', gstin: '27AAPFU0939F1ZV' },
    });
    const res = await importFile(
      admin,
      csv('Whey,,,,,,,,1000,900,', 'Bar,,,,,,21069099,18,100,90,'),
    );
    expect(res.body).toMatchObject({ createdCount: 1, failedCount: 1 });
    expect(res.body.failedRows[0].errors.map((e: { field: string }) => e.field).sort()).toEqual([
      'gst_percent',
      'hsn',
    ]);
  });

  it('refuses a cost column from someone without products.cost.read, row by row, and imports the rest', async () => {
    const { owner } = await shop();
    const noCost = await addTeamMember(
      t,
      owner,
      'ADMIN',
      { deniedPermissions: ['products.cost.read'] },
      'nocost',
    );
    const res = await importFile(
      noCost,
      csv('With cost,,,,,,,,100,90,50', 'Without cost,,,,,,,,100,90,'),
    );
    expect(res.body).toMatchObject({ createdCount: 1, failedCount: 1 });
    expect(res.body.failedRows[0].errors[0]).toMatchObject({ field: 'cost' });
  });

  it('reports problems with the file itself: no price column, empty, not CSV, no file at all', async () => {
    const { admin } = await shop();
    const noPrice = await importFile(admin, Buffer.from('name,mrp\nX,10'));
    expect(noPrice.body.fileErrors).toEqual(['The file has no "price" column.']);
    expect((await importFile(admin, Buffer.from('name,mrp,price'))).body.fileErrors[0]).toMatch(
      /no product rows/,
    );
    expect(
      (await importFile(admin, Buffer.from('name,mrp,price\n"oops,1,2'))).body.fileErrors[0],
    ).toMatch(/not valid CSV/);
    const none = await t
      .http()
      .post('/v1/products/import')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('X-Forwarded-For', t.freshIp())
      .field('x', 'y');
    expect(none.status).toBe(400);
  });

  it('reads an Excel-style file (byte-order mark, quoted commas) and ignores unknown columns', async () => {
    const { admin } = await shop();
    const file = Buffer.from('﻿Name,MRP,Price,Colour\r\n"Whey, Chocolate",1000,900,Brown\r\n');
    const res = await importFile(admin, file);
    expect(res.body).toMatchObject({ createdCount: 1, ignoredColumns: ['colour'] });
    expect((await as(t, admin).get('/v1/products?q=whey')).body.items[0].name).toBe(
      'Whey, Chocolate',
    );
  });

  it('counts imported products towards the first-steps checklist', async () => {
    const { owner, admin } = await shop();
    const steps = async () =>
      (await as(t, owner).get('/v1/business/onboarding')).body.steps.find(
        (s: { key: string }) => s.key === 'PRODUCTS',
      ).done;
    expect(await steps()).toBe(false);
    await importFile(admin, csv('Whey,,,,,,,,1000,900,'));
    expect(await steps()).toBe(true);
  });
});
