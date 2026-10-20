import { randomUUID } from 'node:crypto';
import { createApiDocument } from '../../src/swagger';
import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import {
  buy,
  daysFromToday,
  makeShop,
  newProduct,
  newSupplier,
  postWithKey,
  seedGrowthPlan,
  Shop,
  stockOf,
} from '../support/inventory-helpers';
import { addTeamMember, as } from '../support/team-helpers';

/**
 * Stock, end to end against the real application and a real PostgreSQL database: levels and the ledger, counts, expiry
 * handling, alerts, transfers between branches, the "last unit" race, the ledger invariant, and cost secrecy.
 */
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp();
  await seedGrowthPlan(t);
});

afterAll(async () => {
  await t.close();
});

/** A shop with one product holding `qty` units at `unitCostPaise` in the main branch. */
async function stocked(
  qty: number,
  unitCostPaise: number,
  batch?: { batchNo: string; expiryDate: string },
) {
  const shop = await makeShop(t);
  const product = await newProduct(t, shop.admin);
  const supplier = await newSupplier(t, shop.admin);
  await buy(t, shop.admin, {
    supplierId: supplier,
    branchId: shop.mainBranchId,
    lines: [{ productId: product, qty, unitCostPaise, ...batch }],
  });
  return { shop, product, supplier };
}

function adjust(
  shop: Shop,
  who: keyof Pick<Shop, 'admin' | 'owner' | 'cashier'>,
  body: object,
  key: string | null = randomUUID(),
) {
  return postWithKey(t, shop[who], '/v1/stock/adjustments', body, key);
}

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await t.db.owner.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.action);
}

/** Any key that smells like cost, value or average cost. */
const COST_LIKE_KEY = /cost|margin|profit|wac|purchase|landed|cogs|value/i;
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

describe('stock levels', () => {
  it('shows quantities to a cashier and the average cost and value only to people with cost access', async () => {
    const { shop, product } = await stocked(10, 20_000);
    const cashierView = await as(t, shop.cashier).get(`/v1/stock?branchId=${shop.mainBranchId}`);
    expect(cashierView.status).toBe(200);
    expect(
      cashierView.body.items.find((i: { productId: string }) => i.productId === product),
    ).toMatchObject({ qty: 10, isLow: false });
    const adminView = await stockOf(t, shop.admin, shop.mainBranchId, product);
    expect(adminView).toMatchObject({ qty: 10, wacPaise: 20_000, valuePaise: 200_000 });
  });

  it('lists never-stocked active products with 0, searches, pages and filters to low stock', async () => {
    const { shop, product } = await stocked(3, 1_000);
    const other = await newProduct(t, shop.admin, {
      name: 'Shaker bottle',
      brand: 'Dumbbill',
      variant: '',
    });
    const all = (await as(t, shop.admin).get(`/v1/stock?branchId=${shop.mainBranchId}`)).body;
    expect(all.total).toBe(2);
    expect(all.items.find((i: { productId: string }) => i.productId === other).qty).toBe(0);
    expect(
      (await as(t, shop.admin).get(`/v1/stock?branchId=${shop.mainBranchId}&q=shaker`)).body.total,
    ).toBe(1);
    expect(
      (await as(t, shop.admin).get(`/v1/stock?branchId=${shop.mainBranchId}&limit=1&offset=1`)).body
        .items,
    ).toHaveLength(1);

    await as(t, shop.admin).put('/v1/stock/thresholds', {
      branchId: shop.mainBranchId,
      productId: product,
      minQty: 5,
    });
    const low = (
      await as(t, shop.admin).get(`/v1/stock?branchId=${shop.mainBranchId}&lowOnly=true`)
    ).body;
    expect(low.items.map((i: { productId: string }) => i.productId)).toEqual([product]);
    expect(low.items[0]).toMatchObject({ qty: 3, minQty: 5, isLow: true });
  });

  it("respects a person's branches and other businesses", async () => {
    const { shop } = await stocked(3, 1_000);
    const other = await makeShop(t);
    expect(
      (await as(t, shop.cashier).get(`/v1/stock?branchId=${shop.secondBranchId}`)).status,
    ).toBe(403);
    expect((await as(t, other.admin).get(`/v1/stock?branchId=${shop.mainBranchId}`)).status).toBe(
      404,
    );
    expect((await as(t, shop.admin).get('/v1/stock')).status).toBe(400);
  });
});

describe('the cashier-leak scanner for stock (cost secrecy, hard rule 3)', () => {
  it('shows a cashier no cost, value or average cost on any stock response they can get', async () => {
    const { shop, product } = await stocked(10, 123_457);
    const responses = [
      await as(t, shop.cashier).get(`/v1/stock?branchId=${shop.mainBranchId}`),
      await as(t, shop.cashier).get(`/v1/stock?branchId=${shop.mainBranchId}&q=whey&lowOnly=false`),
    ];
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(costLikeKeys(res.body)).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('123457');
    }
    // The ledger and the alerts are not for cashiers at all.
    expect(
      (await as(t, shop.cashier).get(`/v1/stock/ledger?branchId=${shop.mainBranchId}`)).status,
    ).toBe(403);
    expect((await as(t, shop.cashier).get('/v1/stock/alerts')).status).toBe(403);
    void product;
  });

  it('also applies to a person who may count stock but has no cost access', async () => {
    const { shop, product } = await stocked(10, 123_457);
    const counter = await addTeamMember(
      t,
      shop.owner,
      'ADMIN',
      { deniedPermissions: ['products.cost.read'] },
      'nocost',
    );
    for (const path of [
      `/v1/stock?branchId=${shop.mainBranchId}`,
      `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}`,
    ]) {
      const res = await as(t, counter).get(path);
      expect(res.status).toBe(200);
      expect(costLikeKeys(res.body)).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('123457');
    }
    // Their own count answer has no cost either, and found units are still valued at the average (not by what they say).
    const res = await adjust({ ...shop, admin: counter }, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 12,
      reason: 'RECOUNT',
    });
    expect(res.status).toBe(201);
    expect(costLikeKeys(res.body)).toEqual([]);
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 12,
      wacPaise: 123_457,
    });
  });

  it('documents the cashier types without any cost field (the written contract itself)', () => {
    const schemas = createApiDocument(t.app).components?.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    for (const name of ['StockRowCashierDto', 'LedgerEntryDto']) {
      expect(Object.keys(schemas[name]!.properties)).not.toEqual([]);
      expect(costLikeKeys(schemas[name]!.properties)).toEqual([]);
    }
    for (const name of ['StockRowAdminDto', 'LedgerEntryAdminDto']) {
      expect(costLikeKeys(schemas[name]!.properties).length).toBeGreaterThan(0);
    }
  });
});

describe('counting stock (adjustments)', () => {
  it('a lower count removes units at the average cost, with the reason and before/after in the audit log', async () => {
    const { shop, product } = await stocked(10, 20_000);
    const res = await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 7,
      reason: 'DAMAGE',
      note: 'Three tubs split',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ qtyBefore: 10, qtyAfter: 7 });
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 7,
      valuePaise: 140_000,
      wacPaise: 20_000,
    });
    const [entry] = (
      await as(t, shop.admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}`,
      )
    ).body.items;
    expect(entry).toMatchObject({
      type: 'ADJUSTMENT_OUT',
      qtyDelta: -3,
      valueDeltaPaise: -60_000,
      reason: 'DAMAGE',
      note: 'Three tubs split',
      createdByName: 'admin person',
    });
    const audit = await t.db.owner.auditLog.findFirstOrThrow({
      where: { tenantId: shop.owner.tenantId, action: 'stock.adjusted' },
    });
    expect(audit).toMatchObject({
      actorRole: 'Admin',
      before: { qty: 10 },
      after: { qty: 7 },
      entityId: product,
    });
    expect(audit.metadata).toEqual({ branchId: shop.mainBranchId, reason: 'DAMAGE' });
  });

  it('a higher count adds units at the current average cost', async () => {
    const { shop, product } = await stocked(10, 20_000);
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 14,
      reason: 'RECOUNT',
    });
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 14,
      valuePaise: 280_000,
      wacPaise: 20_000,
    });
    const [entry] = (
      await as(t, shop.admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}`,
      )
    ).body.items;
    expect(entry).toMatchObject({ type: 'ADJUSTMENT_IN', qtyDelta: 4, unitCostPaise: 20_000 });
  });

  it('finds stock on a product with no average yet: uses the cost given, else the product cost, else nothing', async () => {
    const shop = await makeShop(t);
    const a = await newProduct(t, shop.admin);
    const b = await newProduct(t, shop.admin, { purchaseCostPaise: 7_000 });
    const c = await newProduct(t, shop.admin);
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: a,
      countedQty: 2,
      reason: 'RECOUNT',
      unitCostPaise: 5_000,
    });
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: b,
      countedQty: 2,
      reason: 'RECOUNT',
    });
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: c,
      countedQty: 2,
      reason: 'RECOUNT',
    });
    expect((await stockOf(t, shop.admin, shop.mainBranchId, a)).valuePaise).toBe(10_000);
    expect((await stockOf(t, shop.admin, shop.mainBranchId, b)).valuePaise).toBe(14_000);
    expect((await stockOf(t, shop.admin, shop.mainBranchId, c)).valuePaise).toBe(0);
  });

  it('a count that matches the books is refused, and a count can bring stock to exactly zero', async () => {
    const { shop, product } = await stocked(5, 1_000);
    const same = await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 5,
      reason: 'RECOUNT',
    });
    expect(same.status).toBe(422);
    expect(
      (
        await adjust(shop, 'admin', {
          branchId: shop.mainBranchId,
          productId: product,
          countedQty: 0,
          reason: 'LOST',
        })
      ).status,
    ).toBe(201);
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 0,
      valuePaise: 0,
    });
  });

  it('needs a reason from the list, stock.adjust, a branch the person may use, and an Idempotency-Key', async () => {
    const { shop, product } = await stocked(5, 1_000);
    const body = {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 3,
      reason: 'RECOUNT',
    };
    expect((await adjust(shop, 'admin', { ...body, reason: 'FEELING' })).status).toBe(400);
    expect((await adjust(shop, 'admin', { ...body, reason: undefined })).status).toBe(400);
    expect((await adjust(shop, 'cashier', body)).status).toBe(403);
    expect((await adjust(shop, 'admin', body, null)).status).toBe(400);
    const limited = await addTeamMember(
      t,
      shop.owner,
      'CASHIER',
      { branchIds: [shop.mainBranchId], extraPermissions: ['stock.adjust'] },
      'limited',
    );
    expect(
      (
        await postWithKey(t, limited, '/v1/stock/adjustments', {
          ...body,
          branchId: shop.secondBranchId,
        })
      ).status,
    ).toBe(403);
    expect((await postWithKey(t, limited, '/v1/stock/adjustments', body)).status).toBe(201);
  });

  it('a retry with the same key counts once; the same key with another count is refused', async () => {
    const { shop, product } = await stocked(10, 1_000);
    const key = randomUUID();
    const body = {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 6,
      reason: 'RECOUNT',
    };
    const first = await adjust(shop, 'admin', body, key);
    const again = await adjust(shop, 'admin', body, key);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(6);
    const other = await adjust(shop, 'admin', { ...body, countedQty: 2 }, key);
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('unknown products are 404 and other businesses cannot be touched', async () => {
    const { shop, product } = await stocked(5, 1_000);
    const other = await makeShop(t);
    expect(
      (
        await adjust(shop, 'admin', {
          branchId: shop.mainBranchId,
          productId: randomUUID(),
          countedQty: 1,
          reason: 'RECOUNT',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await postWithKey(t, other.admin, '/v1/stock/adjustments', {
          branchId: shop.mainBranchId,
          productId: product,
          countedQty: 0,
          reason: 'LOST',
        })
      ).status,
    ).toBe(404);
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(5);
  });
});

describe('batches leave in expiry order (FEFO) and expired goods are written off', () => {
  async function twoBatches() {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        {
          productId: product,
          qty: 5,
          unitCostPaise: 1_000,
          batchNo: 'LATE',
          expiryDate: daysFromToday(t, 300),
        },
        {
          productId: product,
          qty: 5,
          unitCostPaise: 1_000,
          batchNo: 'SOON',
          expiryDate: daysFromToday(t, 20),
        },
        { productId: product, qty: 5, unitCostPaise: 1_000 },
      ],
    });
    return { shop, product };
  }
  const remaining = async (product: string) =>
    Object.fromEntries(
      (await t.db.owner.stockBatch.findMany({ where: { productId: product } })).map((b) => [
        b.batchNo ?? 'NONE',
        b.qtyRemaining,
      ]),
    );

  it('takes from the batch that expires first, then the next, and leaves batches without a date for last', async () => {
    const { shop, product } = await twoBatches();
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 12,
      reason: 'LOST',
    });
    expect(await remaining(product)).toEqual({ SOON: 2, LATE: 5, NONE: 5 });
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 4,
      reason: 'LOST',
    });
    expect(await remaining(product)).toEqual({ SOON: 0, LATE: 0, NONE: 4 });
    // Each batch touched has its own ledger row, so the drilldown shows which batch lost units.
    const entries = (
      await as(t, shop.admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}&type=ADJUSTMENT_OUT`,
      )
    ).body.items;
    expect(
      entries
        .map((e: { batchNo: string | null; qtyDelta: number }) => [e.batchNo, e.qtyDelta])
        .sort(),
    ).toEqual(
      [
        ['LATE', -5],
        ['SOON', -2],
        ['SOON', -3],
        [null, -1],
      ].sort(),
    );
  });

  it('can count out of one named batch', async () => {
    const { shop, product } = await twoBatches();
    const late = await t.db.owner.stockBatch.findFirstOrThrow({
      where: { productId: product, batchNo: 'LATE' },
    });
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 12,
      reason: 'DAMAGE',
      batchId: late.id,
    });
    expect(await remaining(product)).toEqual({ SOON: 5, LATE: 2, NONE: 5 });
    const tooMany = await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 2,
      reason: 'DAMAGE',
      batchId: late.id,
    });
    expect(tooMany.status).toBe(422);
  });

  it('writes off an expired batch at the average cost, and refuses a batch that has not expired', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        {
          productId: product,
          qty: 10,
          unitCostPaise: 2_000,
          batchNo: 'EXP',
          expiryDate: daysFromToday(t, 1),
        },
      ],
    });
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        {
          productId: product,
          qty: 10,
          unitCostPaise: 4_000,
          batchNo: 'FRESH',
          expiryDate: daysFromToday(t, 400),
        },
      ],
    });
    const expiring = await t.db.owner.stockBatch.findFirstOrThrow({
      where: { productId: product, batchNo: 'EXP' },
    });
    const fresh = await t.db.owner.stockBatch.findFirstOrThrow({
      where: { productId: product, batchNo: 'FRESH' },
    });
    const writeOff = (batchId: string, extra: object = {}) =>
      postWithKey(t, shop.admin, '/v1/stock/write-offs', {
        branchId: shop.mainBranchId,
        batchId,
        ...extra,
      });

    // Not expired yet (it expires tomorrow): refused.
    expect((await writeOff(expiring.id)).status).toBe(422);
    expect((await writeOff(fresh.id)).status).toBe(422);

    // Two days later the first batch has expired; the second has not.
    t.clock.advanceSeconds(2 * 24 * 3600);
    // (An access token lives 15 minutes, so sign in again after moving the clock.)
    const admin = await (await import('../support/team-helpers')).signIn(t, shop.admin.email);
    const res = await postWithKey(t, admin, '/v1/stock/write-offs', {
      branchId: shop.mainBranchId,
      batchId: expiring.id,
      qty: 4,
      note: 'Past date',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ qtyBefore: 20, qtyAfter: 16 });
    // Average of 10 @ Rs 20 and 10 @ Rs 40 is Rs 30; 4 units leave at Rs 30 each.
    const ledger = (
      await as(t, admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}&type=EXPIRY_WRITE_OFF`,
      )
    ).body.items;
    expect(ledger[0]).toMatchObject({
      qtyDelta: -4,
      valueDeltaPaise: -12_000,
      reason: 'EXPIRED',
      refType: 'WRITE_OFF',
      batchNo: 'EXP',
    });
    expect(
      (
        await postWithKey(t, admin, '/v1/stock/write-offs', {
          branchId: shop.mainBranchId,
          batchId: fresh.id,
        })
      ).status,
    ).toBe(422);
    // The rest of the batch can go too, but not more than is left.
    expect(
      (
        await postWithKey(t, admin, '/v1/stock/write-offs', {
          branchId: shop.mainBranchId,
          batchId: expiring.id,
          qty: 9,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await postWithKey(t, admin, '/v1/stock/write-offs', {
          branchId: shop.mainBranchId,
          batchId: expiring.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (await t.db.owner.stockBatch.findUniqueOrThrow({ where: { id: expiring.id } })).qtyRemaining,
    ).toBe(0);
    expect(
      (
        await postWithKey(t, admin, '/v1/stock/write-offs', {
          branchId: shop.mainBranchId,
          batchId: expiring.id,
        })
      ).status,
    ).toBe(422);
    expect(await auditActions(shop.owner.tenantId)).toContain('stock.expiry_written_off');
  });
});

describe('alerts and settings', () => {
  it('lists low stock, near-expiry and expired batches, and the window can be changed', async () => {
    const shop = await makeShop(t);
    const supplier = await newSupplier(t, shop.admin);
    const low = await newProduct(t, shop.admin);
    const soon = await newProduct(t, shop.admin);
    const later = await newProduct(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        { productId: low, qty: 2, unitCostPaise: 100 },
        {
          productId: soon,
          qty: 4,
          unitCostPaise: 100,
          batchNo: 'S',
          expiryDate: daysFromToday(t, 30),
        },
        {
          productId: later,
          qty: 6,
          unitCostPaise: 100,
          batchNo: 'L',
          expiryDate: daysFromToday(t, 90),
        },
      ],
    });
    await as(t, shop.admin).put('/v1/stock/thresholds', {
      branchId: shop.mainBranchId,
      productId: low,
      minQty: 5,
    });

    const alerts = (await as(t, shop.admin).get('/v1/stock/alerts')).body;
    expect(alerts.nearExpiryDays).toBe(60);
    expect(alerts.lowStock).toHaveLength(1);
    expect(alerts.lowStock[0]).toMatchObject({ productId: low, qty: 2, minQty: 5 });
    expect(alerts.nearExpiry.map((a: { batchNo: string }) => a.batchNo)).toEqual(['S']);
    expect(alerts.nearExpiry[0]).toMatchObject({ qtyRemaining: 4, daysLeft: 30 });
    expect(alerts.expired).toEqual([]);

    // Widen the window to 100 days: the later batch now shows too.
    expect(
      (await as(t, shop.owner).put('/v1/stock/settings', { nearExpiryDays: 100 })).body
        .nearExpiryDays,
    ).toBe(100);
    expect((await as(t, shop.owner).get('/v1/stock/settings')).body.nearExpiryDays).toBe(100);
    expect(
      (await as(t, shop.admin).get('/v1/stock/alerts')).body.nearExpiry.map(
        (a: { batchNo: string }) => a.batchNo,
      ),
    ).toEqual(['S', 'L']);
    // A threshold of 0 switches the alert off.
    await as(t, shop.admin).put('/v1/stock/thresholds', {
      branchId: shop.mainBranchId,
      productId: low,
      minQty: 0,
    });
    expect((await as(t, shop.admin).get('/v1/stock/alerts')).body.lowStock).toEqual([]);
    expect(await auditActions(shop.owner.tenantId)).toEqual(
      expect.arrayContaining(['stock.settings_changed', 'stock.threshold_set']),
    );
  });

  it('shows expired batches that still hold units, and only for branches the person may use', async () => {
    const shop = await makeShop(t);
    const supplier = await newSupplier(t, shop.admin);
    const product = await newProduct(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.secondBranchId,
      lines: [
        {
          productId: product,
          qty: 3,
          unitCostPaise: 100,
          batchNo: 'OLD',
          expiryDate: daysFromToday(t, 0),
        },
      ],
    });
    // Make the branch-limited person BEFORE moving the clock (the owner's token only lives 15 minutes).
    const limitedInvite = await addTeamMember(
      t,
      shop.owner,
      'CASHIER',
      { branchIds: [shop.mainBranchId], extraPermissions: ['stock.adjust'] },
      'limited',
    );
    t.clock.advanceSeconds(3 * 24 * 3600);
    // Three days later every access token has expired, so sign in again.
    const { signIn } = await import('../support/team-helpers');
    const admin = await signIn(t, shop.admin.email);
    const limited = await signIn(t, limitedInvite.email);
    const alerts = (await as(t, admin).get('/v1/stock/alerts')).body;
    expect(alerts.expired).toHaveLength(1);
    expect(alerts.expired[0]).toMatchObject({ batchNo: 'OLD', daysLeft: -3, qtyRemaining: 3 });

    expect((await as(t, limited).get('/v1/stock/alerts')).body.expired).toEqual([]);
    expect(
      (await as(t, limited).get(`/v1/stock/alerts?branchId=${shop.secondBranchId}`)).body.expired,
    ).toEqual([]);
  });

  it('settings need settings.manage and a sensible number', async () => {
    const { shop } = await stocked(1, 100);
    expect((await as(t, shop.admin).put('/v1/stock/settings', { nearExpiryDays: 30 })).status).toBe(
      403,
    );
    expect((await as(t, shop.owner).put('/v1/stock/settings', { nearExpiryDays: 0 })).status).toBe(
      400,
    );
    expect(
      (await as(t, shop.owner).put('/v1/stock/settings', { nearExpiryDays: 366 })).status,
    ).toBe(400);
    expect(
      (
        await as(t, shop.admin).put('/v1/stock/thresholds', {
          branchId: shop.mainBranchId,
          productId: randomUUID(),
          minQty: 1,
        })
      ).status,
    ).toBe(404);
  });
});

describe('transfers between branches', () => {
  const transfer = (
    shop: Shop,
    body: object,
    who: 'admin' | 'owner' | 'cashier' = 'admin',
    key: string | null = randomUUID(),
  ) => postWithKey(t, shop[who], '/v1/stock/transfers', body, key);

  it('send takes the goods out at the average cost; receive brings them in at exactly that value', async () => {
    const { shop, product } = await stocked(10, 20_000);
    const sent = await transfer(shop, {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 4 }],
      note: 'Weekend rush',
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({
      status: 'IN_TRANSIT',
      fromBranchName: 'Main branch',
      toBranchName: 'Baner shop',
      note: 'Weekend rush',
    });
    expect(costLikeKeys(sent.body)).toEqual([]);

    // In transit: gone from the sender, not yet at the receiver. Nothing is double counted.
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 6,
      valuePaise: 120_000,
    });
    expect((await stockOf(t, shop.admin, shop.secondBranchId, product)).qty).toBe(0);

    const received = await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`);
    expect(received.status).toBe(200);
    expect(received.body.status).toBe('RECEIVED');
    // The cost travelled with the goods: the receiving branch's average is the sender's.
    expect(await stockOf(t, shop.admin, shop.secondBranchId, product)).toMatchObject({
      qty: 4,
      valuePaise: 80_000,
      wacPaise: 20_000,
    });
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 6,
      valuePaise: 120_000,
    });
    expect(await auditActions(shop.owner.tenantId)).toEqual(
      expect.arrayContaining(['stock.transfer_sent', 'stock.transfer_received']),
    );
  });

  it('a second purchase at the receiving branch averages with the transferred stock', async () => {
    const { shop, product, supplier } = await stocked(10, 20_000);
    const sent = await transfer(shop, {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 5 }],
    });
    await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 5, unitCostPaise: 30_000 }],
    });
    // 5 @ Rs 200 (transferred) + 5 @ Rs 300 = 10 units worth Rs 2,500: average Rs 250.
    expect(await stockOf(t, shop.admin, shop.secondBranchId, product)).toMatchObject({
      qty: 10,
      valuePaise: 250_000,
      wacPaise: 25_000,
    });
  });

  it('carries batches along: the same batch number and expiry arrive at the other branch', async () => {
    const { shop, product } = await stocked(10, 1_000, {
      batchNo: 'LOT7',
      expiryDate: daysFromToday(t, 100),
    });
    const sent = await transfer(shop, {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 3 }],
    });
    expect(sent.body.lines[0]).toMatchObject({
      qty: 3,
      batchNo: 'LOT7',
      expiryDate: daysFromToday(t, 100),
    });
    await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`);
    const batches = await t.db.owner.stockBatch.findMany({
      where: { productId: product },
      orderBy: { qtyRemaining: 'desc' },
    });
    expect(
      batches.map((b) => [
        b.branchId === shop.mainBranchId ? 'main' : 'second',
        b.batchNo,
        b.qtyRemaining,
      ]),
    ).toEqual([
      ['main', 'LOT7', 7],
      ['second', 'LOT7', 3],
    ]);
  });

  it('cancel returns the goods to the sender at the value they left with', async () => {
    const { shop, product } = await stocked(10, 20_000);
    const sent = await transfer(shop, {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 4 }],
    });
    const cancelled = await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/cancel`);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 10,
      valuePaise: 200_000,
      wacPaise: 20_000,
    });
    expect((await stockOf(t, shop.admin, shop.secondBranchId, product)).qty).toBe(0);
    const types = (
      await as(t, shop.admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}`,
      )
    ).body.items.map((e: { type: string }) => e.type);
    expect(types).toEqual(['TRANSFER_CANCEL', 'TRANSFER_OUT', 'PURCHASE']);
  });

  it('can be received or cancelled only once; a second try is told so and changes nothing', async () => {
    const { shop, product } = await stocked(10, 1_000);
    const sent = await transfer(shop, {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 4 }],
    });
    await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`);
    const again = await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`);
    expect(again.status).toBe(409);
    expect(
      (await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/cancel`)).status,
    ).toBe(409);
    expect((await stockOf(t, shop.admin, shop.secondBranchId, product)).qty).toBe(4);
  });

  it('two people receiving at the same moment: exactly one succeeds and the stock arrives once', async () => {
    const { shop, product } = await stocked(10, 1_000);
    const sent = await transfer(shop, {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 4 }],
    });
    const answers = await Promise.all(
      [1, 2, 3, 4].map(() => as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`)),
    );
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(3);
    expect((await stockOf(t, shop.admin, shop.secondBranchId, product)).qty).toBe(4);
  });

  it('refuses more than is on hand (saving nothing), the same branch twice, unknown or switched-off branches', async () => {
    const { shop, product } = await stocked(3, 1_000);
    const tooMany = await transfer(shop, {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 4 }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await t.db.owner.stockTransfer.count({ where: { tenantId: shop.owner.tenantId } })).toBe(
      0,
    );
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(3);
    expect(
      (
        await transfer(shop, {
          fromBranchId: shop.mainBranchId,
          toBranchId: shop.mainBranchId,
          lines: [{ productId: product, qty: 1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await transfer(shop, {
          fromBranchId: shop.mainBranchId,
          toBranchId: randomUUID(),
          lines: [{ productId: product, qty: 1 }],
        })
      ).status,
    ).toBe(404);
    await as(t, shop.owner).post(`/v1/branches/${shop.secondBranchId}/deactivate`);
    expect(
      (
        await transfer(shop, {
          fromBranchId: shop.mainBranchId,
          toBranchId: shop.secondBranchId,
          lines: [{ productId: product, qty: 1 }],
        })
      ).status,
    ).toBe(422);
  });

  it('respects permissions and branches: cashier refused; only the sending side may send or cancel, the receiving side receives', async () => {
    const { shop, product } = await stocked(10, 1_000);
    const body = {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 2 }],
    };
    expect((await transfer(shop, body, 'cashier')).status).toBe(403);
    const mainOnly = await addTeamMember(
      t,
      shop.owner,
      'CASHIER',
      { branchIds: [shop.mainBranchId], extraPermissions: ['stock.transfer'] },
      'mainonly',
    );
    const secondOnly = await addTeamMember(
      t,
      shop.owner,
      'CASHIER',
      { branchIds: [shop.secondBranchId], extraPermissions: ['stock.transfer'] },
      'secondonly',
    );
    // The second-branch person cannot send FROM the main branch.
    expect((await postWithKey(t, secondOnly, '/v1/stock/transfers', body)).status).toBe(403);
    const sent = await postWithKey(t, mainOnly, '/v1/stock/transfers', body);
    expect(sent.status).toBe(201);
    // The sender cannot receive on the other side's behalf; the receiver cannot cancel the sender's.
    expect((await as(t, mainOnly).post(`/v1/stock/transfers/${sent.body.id}/receive`)).status).toBe(
      403,
    );
    expect(
      (await as(t, secondOnly).post(`/v1/stock/transfers/${sent.body.id}/cancel`)).status,
    ).toBe(403);
    // Either end can see it; an outsider with another business cannot.
    expect((await as(t, secondOnly).get(`/v1/stock/transfers/${sent.body.id}`)).status).toBe(200);
    expect(
      (await as(t, secondOnly).get('/v1/stock/transfers?status=IN_TRANSIT')).body.items,
    ).toHaveLength(1);
    expect(
      (await as(t, secondOnly).post(`/v1/stock/transfers/${sent.body.id}/receive`)).status,
    ).toBe(200);
    const other = await makeShop(t);
    expect((await as(t, other.admin).get(`/v1/stock/transfers/${sent.body.id}`)).status).toBe(404);
    expect(
      (await as(t, other.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`)).status,
    ).toBe(404);
  });

  it('a retry with the same key sends once', async () => {
    const { shop, product } = await stocked(10, 1_000);
    const key = randomUUID();
    const body = {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 4 }],
    };
    const first = await transfer(shop, body, 'admin', key);
    const again = await transfer(shop, body, 'admin', key);
    expect(again.body).toEqual(first.body);
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(6);
  });
});

describe('the last unit (concurrency)', () => {
  it('ten people each try to take one of five units at the same moment: exactly five succeed, the rest are refused, stock ends at zero', async () => {
    const { shop, product } = await stocked(5, 1_000);
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        postWithKey(t, shop.admin, '/v1/stock/transfers', {
          fromBranchId: shop.mainBranchId,
          toBranchId: shop.secondBranchId,
          lines: [{ productId: product, qty: 1 }],
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === 201)).toHaveLength(5);
    const refused = attempts.filter((a) => a.status === 422);
    expect(refused).toHaveLength(5);
    expect(new Set(refused.map((a) => a.body.code))).toEqual(new Set(['INSUFFICIENT_STOCK']));
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 0,
      valuePaise: 0,
    });
    expect((await as(t, shop.admin).get('/v1/stock/verify')).body.ok).toBe(true);
  });

  it('simultaneous counts and transfers of many products never deadlock and keep the books exact', async () => {
    const { shop, supplier } = await stocked(1, 100);
    const products = await Promise.all(Array.from({ length: 4 }, () => newProduct(t, shop.admin)));
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: products.map((productId) => ({ productId, qty: 20, unitCostPaise: 1_500 })),
    });
    // The same four products requested in different orders, at once: ordered locking prevents deadlock.
    const orders = [
      products,
      [...products].reverse(),
      [products[1]!, products[3]!, products[0]!, products[2]!],
      [products[2]!, products[0]!, products[3]!, products[1]!],
    ];
    const answers = await Promise.all(
      orders.map((order) =>
        postWithKey(t, shop.admin, '/v1/stock/transfers', {
          fromBranchId: shop.mainBranchId,
          toBranchId: shop.secondBranchId,
          lines: order.map((productId) => ({ productId, qty: 5 })),
        }),
      ),
    );
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201]);
    for (const product of products) {
      expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
        qty: 0,
        valuePaise: 0,
      });
    }
    expect((await as(t, shop.admin).get('/v1/stock/verify')).body.ok).toBe(true);
  });
});

describe('the ledger invariant (US-STK-01)', () => {
  it('after a mix of purchases, counts, returns, transfers and write-offs, every level equals the sum of its ledger and the check agrees', async () => {
    const { shop, product, supplier } = await stocked(20, 10_000, {
      batchNo: 'A',
      expiryDate: daysFromToday(t, 1),
    });
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        {
          productId: product,
          qty: 15,
          unitCostPaise: 12_345,
          batchNo: 'B',
          expiryDate: daysFromToday(t, 200),
        },
      ],
      otherCostPaise: 777,
    });
    await adjust(shop, 'admin', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 30,
      reason: 'LOST',
    });
    await postWithKey(t, shop.admin, '/v1/supplier-returns', {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      reason: 'Back',
      lines: [{ productId: product, qty: 3, unitCreditPaise: 9_000 }],
    });
    const sent = await postWithKey(t, shop.admin, '/v1/stock/transfers', {
      fromBranchId: shop.mainBranchId,
      toBranchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 7 }],
    });
    await as(t, shop.admin).post(`/v1/stock/transfers/${sent.body.id}/receive`);
    await adjust(shop, 'admin', {
      branchId: shop.secondBranchId,
      productId: product,
      countedQty: 9,
      reason: 'RECOUNT',
      unitCostPaise: 1,
    });

    const verify = (await as(t, shop.admin).get('/v1/stock/verify')).body;
    expect(verify).toMatchObject({ ok: true, problems: [] });
    expect(verify.checkedPositions).toBeGreaterThanOrEqual(2);

    // Independent proof from the database: the sums of the ledger equal the levels.
    for (const branchId of [shop.mainBranchId, shop.secondBranchId]) {
      const sums = await t.db.owner.stockLedger.aggregate({
        where: { branchId, productId: product },
        _sum: { qtyDelta: true, valueDeltaPaise: true },
      });
      const level = await t.db.owner.stockLevel.findUniqueOrThrow({
        where: { branchId_productId: { branchId, productId: product } },
      });
      expect([sums._sum.qtyDelta, sums._sum.valueDeltaPaise]).toEqual([
        level.qty,
        level.valuePaise,
      ]);
    }
  });

  it('the check finds a level that has drifted from the ledger, and rebuild puts it right (and does nothing when all agree)', async () => {
    const { shop, product } = await stocked(10, 5_000, {
      batchNo: 'A',
      expiryDate: daysFromToday(t, 100),
    });
    expect((await as(t, shop.owner).post('/v1/stock/rebuild')).body).toEqual({
      levelsFixed: 0,
      batchesFixed: 0,
    });

    // Simulate a fault by editing the projection tables directly (they are not append-only; the ledger is).
    await t.db.owner.stockLevel.update({
      where: { branchId_productId: { branchId: shop.mainBranchId, productId: product } },
      data: { qty: 99 },
    });
    await t.db.owner.stockBatch.updateMany({
      where: { productId: product },
      data: { qtyRemaining: 3 },
    });
    const broken = (await as(t, shop.admin).get('/v1/stock/verify')).body;
    expect(broken.ok).toBe(false);
    expect(broken.problems.map((p: { problem: string }) => p.problem).join(' ')).toMatch(
      /99 but the ledger adds up to 10/,
    );

    const fixed = (await as(t, shop.owner).post('/v1/stock/rebuild')).body;
    expect(fixed).toEqual({ levelsFixed: 1, batchesFixed: 1 });
    expect((await as(t, shop.admin).get('/v1/stock/verify')).body.ok).toBe(true);
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 10,
      valuePaise: 50_000,
    });
    expect(await auditActions(shop.owner.tenantId)).toContain('stock.rebuilt');
    // Only the owner-level permission may rebuild.
    expect((await as(t, shop.admin).post('/v1/stock/rebuild')).status).toBe(403);
  });

  it('the ledger cannot be edited or deleted: even the table owner is refused', async () => {
    const { shop, product } = await stocked(5, 1_000);
    await expect(
      t.db.owner.stockLedger.updateMany({ where: { productId: product }, data: { qtyDelta: 99 } }),
    ).rejects.toThrow(/append-only/i);
    await expect(
      t.db.owner.stockLedger.deleteMany({ where: { productId: product } }),
    ).rejects.toThrow(/append-only/i);
    expect(await t.db.owner.stockLedger.count({ where: { productId: product } })).toBe(1);
    void shop;
  });
});
