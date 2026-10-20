import { randomUUID } from 'node:crypto';
import { gstinCheckCharacter } from '../../src/modules/business/domain/gstin';
import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import {
  buy,
  daysFromToday,
  makeShop,
  newProduct,
  newSupplier,
  postWithKey,
  seedGrowthPlan,
  stockOf,
} from '../support/inventory-helpers';
import { addTeamMember, as } from '../support/team-helpers';

/**
 * Suppliers, purchases and supplier returns, end to end against the real application and a real PostgreSQL database with
 * row-level security. Each scenario is something an owner, an admin, a cashier or an outsider could really do.
 */
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp();
  await seedGrowthPlan(t);
});

afterAll(async () => {
  await t.close();
});

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await t.db.owner.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.action);
}

describe('suppliers', () => {
  it('are added, listed, searched, changed, switched off and on', async () => {
    const { admin } = await makeShop(t);
    const made = await as(t, admin).post('/v1/suppliers', {
      name: 'Nutri Distributors Pvt Ltd',
      phone: '98220 12345',
      email: 'orders@nutridist.in',
      city: 'Pune',
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      name: 'Nutri Distributors Pvt Ltd',
      phone: '9822012345',
      isActive: true,
      balancePaise: 0,
    });
    const id = made.body.id;

    expect((await as(t, admin).get('/v1/suppliers?q=nutri')).body.suppliers).toHaveLength(1);
    expect((await as(t, admin).get('/v1/suppliers?q=zzz')).body.suppliers).toHaveLength(0);
    const changed = await as(t, admin).put(`/v1/suppliers/${id}`, {
      name: 'Nutri Distributors',
      city: 'Mumbai',
    });
    expect(changed.body).toMatchObject({ name: 'Nutri Distributors', city: 'Mumbai', phone: null });

    expect((await as(t, admin).post(`/v1/suppliers/${id}/deactivate`)).body.isActive).toBe(false);
    expect((await as(t, admin).get('/v1/suppliers')).body.suppliers).toHaveLength(0);
    expect((await as(t, admin).get('/v1/suppliers?status=all')).body.suppliers).toHaveLength(1);
    expect((await as(t, admin).post(`/v1/suppliers/${id}/activate`)).body.isActive).toBe(true);
    expect(await auditActions(admin.tenantId)).toEqual(
      expect.arrayContaining([
        'supplier.created',
        'supplier.updated',
        'supplier.deactivated',
        'supplier.activated',
      ]),
    );
  });

  it('refuse a repeated name (ignoring case) and a GSTIN with a wrong check character', async () => {
    const { admin } = await makeShop(t);
    await as(t, admin).post('/v1/suppliers', { name: 'Nutri Distributors' });
    const again = await as(t, admin).post('/v1/suppliers', { name: 'NUTRI distributors' });
    expect(again.status).toBe(409);
    expect(again.body.errors[0].field).toBe('name');

    const first14 = '27AAPFU0939F1Z';
    const good = first14 + gstinCheckCharacter(first14);
    expect(
      (await as(t, admin).post('/v1/suppliers', { name: 'With GSTIN', gstin: good.toLowerCase() }))
        .body.gstin,
    ).toBe(good);
    const wrong = await as(t, admin).post('/v1/suppliers', {
      name: 'Bad GSTIN',
      gstin: good.slice(0, 14) + (good.endsWith('V') ? 'W' : 'V'),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors[0].field).toBe('gstin');
  });

  it('are invisible to a cashier (403) and to another business (404)', async () => {
    const mine = await makeShop(t);
    const theirs = await makeShop(t);
    const theirSupplier = await newSupplier(t, theirs.admin);
    expect((await as(t, mine.cashier).get('/v1/suppliers')).status).toBe(403);
    expect((await as(t, mine.cashier).post('/v1/suppliers', { name: 'Nope' })).status).toBe(403);
    expect((await as(t, mine.admin).get(`/v1/suppliers/${theirSupplier}`)).status).toBe(404);
    expect(
      (await as(t, mine.admin).put(`/v1/suppliers/${theirSupplier}`, { name: 'Hijack' })).status,
    ).toBe(404);
    expect((await as(t, mine.admin).post(`/v1/suppliers/${theirSupplier}/deactivate`)).status).toBe(
      404,
    );
    expect((await as(t, mine.admin).get('/v1/suppliers?status=all')).body.suppliers).toHaveLength(
      0,
    );
  });
});

describe('recording a purchase', () => {
  it('puts the goods into stock at their cost and creates a batch with its expiry', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const purchase = await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        {
          productId: product,
          qty: 24,
          unitCostPaise: 249_900,
          batchNo: 'WH2410A',
          expiryDate: daysFromToday(t, 400),
        },
      ],
    });
    expect(purchase).toMatchObject({
      subtotalPaise: 24 * 249_900,
      totalPaise: 24 * 249_900,
      otherCostPaise: 0,
    });
    expect(purchase.lines[0]).toMatchObject({
      qty: 24,
      lineTotalPaise: 24 * 249_900,
      landedUnitCostPaise: 249_900,
      batchNo: 'WH2410A',
    });

    const level = await stockOf(t, shop.admin, shop.mainBranchId, product);
    expect(level).toMatchObject({ qty: 24, wacPaise: 249_900, valuePaise: 24 * 249_900 });
    // Nothing leaked to the other branch.
    expect((await stockOf(t, shop.admin, shop.secondBranchId, product)).qty).toBe(0);

    const ledger = (
      await as(t, shop.admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}`,
      )
    ).body.items;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: 'PURCHASE',
      qtyDelta: 24,
      qtyAfter: 24,
      batchNo: 'WH2410A',
      refType: 'PURCHASE',
      refId: purchase.id,
    });
    expect(await auditActions(shop.owner.tenantId)).toContain('purchase.created');
  });

  it('keeps BOTH cost layers after a second purchase: the average is the weighted mean (US-PUR-01)', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    // 2 units at Rs 100, then 3 units at Rs 150: 5 units worth Rs 650, average Rs 130.
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 2, unitCostPaise: 10_000 }],
    });
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 3, unitCostPaise: 15_000 }],
    });

    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 5,
      valuePaise: 65_000,
      wacPaise: 13_000,
    });
    const ledger = (
      await as(t, shop.admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}`,
      )
    ).body.items;
    // Newest first. The FIRST purchase's row is exactly as it was: its cost and average were not rewritten by the second.
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({
      qtyDelta: 2,
      unitCostPaise: 10_000,
      valueDeltaPaise: 20_000,
      wacAfterPaise: 10_000,
      valueAfterPaise: 20_000,
    });
    expect(ledger[0]).toMatchObject({
      qtyDelta: 3,
      unitCostPaise: 15_000,
      valueDeltaPaise: 45_000,
      wacAfterPaise: 13_000,
      valueAfterPaise: 65_000,
    });
  });

  it('spreads freight over the lines in proportion to their value, and the shares add up to the paisa', async () => {
    const shop = await makeShop(t);
    const a = await newProduct(t, shop.admin);
    const b = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    // Line A is worth Rs 1,000 and line B Rs 3,000; Rs 400 freight splits Rs 100 / Rs 300.
    const purchase = await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      otherCostPaise: 40_000,
      lines: [
        { productId: a, qty: 10, unitCostPaise: 10_000 },
        { productId: b, qty: 30, unitCostPaise: 10_000 },
      ],
    });
    expect(purchase.subtotalPaise).toBe(400_000);
    expect(purchase.totalPaise).toBe(440_000);
    const [lineA, lineB] = purchase.lines.sort(
      (x: { productId: string }, y: { productId: string }) =>
        x.productId === a ? -1 : y.productId === a ? 1 : 0,
    );
    expect([lineA.allocatedCostPaise, lineB.allocatedCostPaise]).toEqual([10_000, 30_000]);
    expect(lineA.lineTotalPaise + lineB.lineTotalPaise).toBe(440_000);
    // The landed cost, not the supplier's price, is what the stock is worth.
    expect(await stockOf(t, shop.admin, shop.mainBranchId, a)).toMatchObject({
      valuePaise: 110_000,
      wacPaise: 11_000,
    });
  });

  it('shares an awkward freight amount to the exact paisa', async () => {
    const shop = await makeShop(t);
    const products = [
      await newProduct(t, shop.admin),
      await newProduct(t, shop.admin),
      await newProduct(t, shop.admin),
    ];
    const supplier = await newSupplier(t, shop.admin);
    const purchase = await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      otherCostPaise: 100,
      lines: products.map((productId) => ({ productId, qty: 1, unitCostPaise: 500 })),
    });
    const shares = purchase.lines
      .map((line: { allocatedCostPaise: number }) => line.allocatedCostPaise)
      .sort((x: number, y: number) => y - x);
    expect(shares).toEqual([34, 33, 33]);
    expect(shares.reduce((x: number, y: number) => x + y, 0)).toBe(100);
  });

  it('tops up an existing batch when the same batch number and expiry arrive again, and makes a new batch otherwise', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const expiry = daysFromToday(t, 300);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        { productId: product, qty: 5, unitCostPaise: 1_000, batchNo: 'L1', expiryDate: expiry },
      ],
    });
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        { productId: product, qty: 7, unitCostPaise: 1_000, batchNo: 'L1', expiryDate: expiry },
      ],
    });
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [
        {
          productId: product,
          qty: 3,
          unitCostPaise: 1_000,
          batchNo: 'L2',
          expiryDate: daysFromToday(t, 500),
        },
      ],
    });
    const batches = await t.db.owner.stockBatch.findMany({
      where: { productId: product },
      orderBy: { qtyRemaining: 'desc' },
    });
    expect(batches.map((batch) => [batch.batchNo, batch.qtyRemaining])).toEqual([
      ['L1', 12],
      ['L2', 3],
    ]);
  });

  it('refuses an expired batch, a future invoice date, a missing or unknown product, and a bill over Rs 2 crore', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const base = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'X1',
      invoiceDate: daysFromToday(t, 0),
      lines: [{ productId: product, qty: 1, unitCostPaise: 100 }],
    };
    const expired = await postWithKey(t, shop.admin, '/v1/purchases', {
      ...base,
      lines: [{ productId: product, qty: 1, unitCostPaise: 100, expiryDate: daysFromToday(t, -1) }],
    });
    expect(expired.status).toBe(400);
    expect(expired.body.errors[0]).toMatchObject({ field: 'lines[0].expiryDate' });
    // Today itself is still fine.
    expect(
      (
        await postWithKey(t, shop.admin, '/v1/purchases', {
          ...base,
          invoiceRef: 'X2',
          lines: [
            { productId: product, qty: 1, unitCostPaise: 100, expiryDate: daysFromToday(t, 0) },
          ],
        })
      ).status,
    ).toBe(201);

    const future = await postWithKey(t, shop.admin, '/v1/purchases', {
      ...base,
      invoiceRef: 'X3',
      invoiceDate: daysFromToday(t, 3),
    });
    expect(future.body.errors[0].field).toBe('invoiceDate');
    const unknown = await postWithKey(t, shop.admin, '/v1/purchases', {
      ...base,
      invoiceRef: 'X4',
      lines: [{ productId: randomUUID(), qty: 1, unitCostPaise: 100 }],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors[0].field).toBe('lines[0].productId');
    const huge = await postWithKey(t, shop.admin, '/v1/purchases', {
      ...base,
      invoiceRef: 'X5',
      lines: [{ productId: product, qty: 1_000_000, unitCostPaise: 1_000_000 }],
    });
    expect(huge.status).toBe(422);
    const notReal = await postWithKey(t, shop.admin, '/v1/purchases', {
      ...base,
      invoiceRef: 'X6',
      invoiceDate: '2026-02-30',
    });
    expect(notReal.body.errors[0].field).toBe('invoiceDate');
  });

  it('will not take the same supplier invoice number twice, but another supplier may use it', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const one = await newSupplier(t, shop.admin);
    const two = await newSupplier(t, shop.admin);
    const lines = [{ productId: product, qty: 1, unitCostPaise: 100 }];
    await buy(t, shop.admin, {
      supplierId: one,
      branchId: shop.mainBranchId,
      lines,
      invoiceRef: 'NDP/0417',
    });
    const again = await postWithKey(t, shop.admin, '/v1/purchases', {
      supplierId: one,
      branchId: shop.mainBranchId,
      invoiceRef: 'ndp/0417',
      invoiceDate: daysFromToday(t, 0),
      lines,
    });
    expect(again.status).toBe(409);
    expect(again.body.errors[0].field).toBe('invoiceRef');
    await buy(t, shop.admin, {
      supplierId: two,
      branchId: shop.mainBranchId,
      lines,
      invoiceRef: 'NDP/0417',
    });
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(2);
  });

  it('refuses a switched-off supplier, a switched-off product, and a switched-off branch', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const lines = [{ productId: product, qty: 1, unitCostPaise: 100 }];
    await as(t, shop.admin).post(`/v1/suppliers/${supplier}/deactivate`);
    expect(
      (
        await postWithKey(t, shop.admin, '/v1/purchases', {
          supplierId: supplier,
          branchId: shop.mainBranchId,
          invoiceRef: 'S1',
          invoiceDate: daysFromToday(t, 0),
          lines,
        })
      ).status,
    ).toBe(422);
    await as(t, shop.admin).post(`/v1/suppliers/${supplier}/activate`);
    await as(t, shop.admin).post(`/v1/products/${product}/deactivate`);
    const off = await postWithKey(t, shop.admin, '/v1/purchases', {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'S2',
      invoiceDate: daysFromToday(t, 0),
      lines,
    });
    expect(off.status).toBe(400);
    await as(t, shop.admin).post(`/v1/products/${product}/activate`);
    await as(t, shop.owner).post(`/v1/branches/${shop.secondBranchId}/deactivate`);
    expect(
      (
        await postWithKey(t, shop.admin, '/v1/purchases', {
          supplierId: supplier,
          branchId: shop.secondBranchId,
          invoiceRef: 'S3',
          invoiceDate: daysFromToday(t, 0),
          lines,
        })
      ).status,
    ).toBe(422);
  });

  it('saves nothing when one line fails: no purchase, no stock, no batch', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const res = await postWithKey(t, shop.admin, '/v1/purchases', {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'ATOMIC',
      invoiceDate: daysFromToday(t, 0),
      lines: [
        { productId: product, qty: 5, unitCostPaise: 1_000 },
        { productId: product, qty: 5, unitCostPaise: 1_000, expiryDate: daysFromToday(t, -5) },
      ],
    });
    expect(res.status).toBe(400);
    expect(await t.db.owner.purchase.count({ where: { tenantId: shop.owner.tenantId } })).toBe(0);
    expect(await t.db.owner.stockLedger.count({ where: { tenantId: shop.owner.tenantId } })).toBe(
      0,
    );
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(0);
  });

  it('lists and shows purchases, newest first, only for branches the person may use', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const first = await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 1, unitCostPaise: 100 }],
    });
    const second = await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.secondBranchId,
      lines: [{ productId: product, qty: 2, unitCostPaise: 100 }],
    });
    const list = (await as(t, shop.admin).get('/v1/purchases')).body;
    expect(list.items.map((p: { id: string }) => p.id)).toEqual([second.id, first.id]);
    expect(list.items[0]).toMatchObject({
      lineCount: 1,
      totalPaise: 200,
      supplierName: expect.any(String),
    });
    expect(
      (await as(t, shop.admin).get(`/v1/purchases?branchId=${shop.mainBranchId}`)).body.total,
    ).toBe(1);
    expect(
      (await as(t, shop.admin).get(`/v1/purchases/${first.id}`)).body.lines[0].productName,
    ).toMatch(/Test whey/);

    // A person limited to the main branch cannot see the second branch's purchase.
    const limited = await addTeamMember(
      t,
      shop.owner,
      'CASHIER',
      { branchIds: [shop.mainBranchId], extraPermissions: ['purchases.write'] },
      'limited',
    );
    expect(
      (await as(t, limited).get('/v1/purchases')).body.items.map((p: { id: string }) => p.id),
    ).toEqual([first.id]);
    expect((await as(t, limited).get(`/v1/purchases/${second.id}`)).status).toBe(403);
    // Asking for a branch outside their scope is refused, not answered with an empty list.
    expect((await as(t, limited).get(`/v1/purchases?branchId=${shop.secondBranchId}`)).status).toBe(
      403,
    );
  });
});

describe('the first-steps checklist', () => {
  it('turns the supplier and purchase steps done by really adding a supplier and recording a purchase', async () => {
    const shop = await makeShop(t);
    const steps = async () =>
      Object.fromEntries(
        (await as(t, shop.owner).get('/v1/business/onboarding')).body.steps.map(
          (s: { key: string; done: boolean }) => [s.key, s.done],
        ),
      );
    expect(await steps()).toMatchObject({ SUPPLIER: false, PURCHASE: false });
    const supplier = await newSupplier(t, shop.admin);
    expect(await steps()).toMatchObject({ SUPPLIER: true, PURCHASE: false });
    const product = await newProduct(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 1, unitCostPaise: 100 }],
    });
    expect(await steps()).toMatchObject({ SUPPLIER: true, PURCHASE: true, PRODUCTS: true });
  });
});

describe('Idempotency-Key on purchases (hard rule 6)', () => {
  const lineFor = (productId: string) => [{ productId, qty: 4, unitCostPaise: 1_000 }];

  it('a retry with the same key returns the SAME purchase and does not add stock twice', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const key = randomUUID();
    const body = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'RETRY-1',
      invoiceDate: daysFromToday(t, 0),
      lines: lineFor(product),
    };
    const first = await postWithKey(t, shop.admin, '/v1/purchases', body, key);
    const second = await postWithKey(t, shop.admin, '/v1/purchases', body, key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body).toEqual(first.body);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(4);
    expect(await t.db.owner.purchase.count({ where: { tenantId: shop.owner.tenantId } })).toBe(1);
  });

  it('the same key with a different request is refused (IDEMPOTENCY_KEY_REUSED)', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const key = randomUUID();
    const body = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'KEY-A',
      invoiceDate: daysFromToday(t, 0),
      lines: lineFor(product),
    };
    await postWithKey(t, shop.admin, '/v1/purchases', body, key);
    const other = await postWithKey(
      t,
      shop.admin,
      '/v1/purchases',
      { ...body, invoiceRef: 'KEY-B' },
      key,
    );
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(4);
  });

  it('two attempts at the very same moment create exactly one purchase', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const key = randomUUID();
    const body = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'RACE-1',
      invoiceDate: daysFromToday(t, 0),
      lines: lineFor(product),
    };
    const answers = await Promise.all(
      [1, 2, 3].map(() => postWithKey(t, shop.admin, '/v1/purchases', body, key)),
    );
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201]);
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(4);
  });

  it('a failed attempt does not burn the key: fixing the request and retrying with the same key works', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const key = randomUUID();
    const bad = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'FIX-1',
      invoiceDate: daysFromToday(t, 3),
      lines: lineFor(product),
    };
    expect((await postWithKey(t, shop.admin, '/v1/purchases', bad, key)).status).toBe(400);
    const fixed = await postWithKey(
      t,
      shop.admin,
      '/v1/purchases',
      { ...bad, invoiceDate: daysFromToday(t, 0) },
      key,
    );
    expect(fixed.status).toBe(201);
  });

  it('needs the header, and refuses a malformed key', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const body = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      invoiceRef: 'NOKEY',
      invoiceDate: daysFromToday(t, 0),
      lines: lineFor(product),
    };
    const missing = await postWithKey(t, shop.admin, '/v1/purchases', body, null);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('BAD_REQUEST');
    expect((await postWithKey(t, shop.admin, '/v1/purchases', body, 'short')).status).toBe(400);
    expect(
      (await postWithKey(t, shop.admin, '/v1/purchases', body, 'has spaces and !!')).status,
    ).toBe(400);
  });

  it("one business's key never collides with another's", async () => {
    const a = await makeShop(t);
    const b = await makeShop(t);
    const key = randomUUID();
    for (const shop of [a, b]) {
      const product = await newProduct(t, shop.admin);
      const supplier = await newSupplier(t, shop.admin);
      const res = await postWithKey(
        t,
        shop.admin,
        '/v1/purchases',
        {
          supplierId: supplier,
          branchId: shop.mainBranchId,
          invoiceRef: 'SAME',
          invoiceDate: daysFromToday(t, 0),
          lines: lineFor(product),
        },
        key,
      );
      expect(res.status).toBe(201);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    }
  });
});

describe('who may record purchases', () => {
  it('refuses a cashier, a person limited to another branch, and another business', async () => {
    const shop = await makeShop(t);
    const other = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    const body = (branchId: string, invoiceRef: string) => ({
      supplierId: supplier,
      branchId,
      invoiceRef,
      invoiceDate: daysFromToday(t, 0),
      lines: [{ productId: product, qty: 1, unitCostPaise: 100 }],
    });
    expect(
      (await postWithKey(t, shop.cashier, '/v1/purchases', body(shop.mainBranchId, 'C1'))).status,
    ).toBe(403);

    const limited = await addTeamMember(
      t,
      shop.owner,
      'CASHIER',
      { branchIds: [shop.mainBranchId], extraPermissions: ['purchases.write'] },
      'limited',
    );
    expect(
      (await postWithKey(t, limited, '/v1/purchases', body(shop.mainBranchId, 'C2'))).status,
    ).toBe(201);
    const wrongBranch = await postWithKey(
      t,
      limited,
      '/v1/purchases',
      body(shop.secondBranchId, 'C3'),
    );
    expect(wrongBranch.status).toBe(403);

    // Another business's branch and supplier are 404, never a hint that they exist.
    const crossBranch = await postWithKey(
      t,
      other.admin,
      '/v1/purchases',
      body(shop.mainBranchId, 'C4'),
    );
    expect(crossBranch.status).toBe(404);
    expect((await as(t, other.admin).get('/v1/purchases')).body.total).toBe(0);
  });

  it('keeps cost amounts out of the audit log', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 3, unitCostPaise: 1_234_567 }],
    });
    const rows = await t.db.owner.auditLog.findMany({ where: { tenantId: shop.owner.tenantId } });
    expect(JSON.stringify(rows.map((r) => [r.metadata, r.before, r.after]))).not.toContain(
      '1234567',
    );
  });
});

describe('supplier returns and debit notes', () => {
  it('take the goods out at the average cost, number the debit note, and lower what is owed to the supplier', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 10, unitCostPaise: 20_000 }],
    });
    expect((await as(t, shop.admin).get(`/v1/suppliers/${supplier}`)).body.balancePaise).toBe(
      200_000,
    );

    const res = await postWithKey(t, shop.admin, '/v1/supplier-returns', {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      reason: 'Damaged in transit',
      lines: [{ productId: product, qty: 4, unitCreditPaise: 19_000 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      debitNoteNo: 'DN-0001',
      creditTotalPaise: 76_000,
      reason: 'Damaged in transit',
    });
    expect(res.body.lines[0]).toMatchObject({
      qty: 4,
      unitCreditPaise: 19_000,
      creditPaise: 76_000,
    });

    // Stock left at its cost (4 x Rs 200), so the average of what remains is unchanged.
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 6,
      valuePaise: 120_000,
      wacPaise: 20_000,
    });
    const ledger = (
      await as(t, shop.admin).get(
        `/v1/stock/ledger?branchId=${shop.mainBranchId}&productId=${product}&type=SUPPLIER_RETURN`,
      )
    ).body.items;
    expect(ledger[0]).toMatchObject({
      qtyDelta: -4,
      valueDeltaPaise: -80_000,
      reason: 'Damaged in transit',
    });
    // Owed: the bill (Rs 2,000) less the credit (Rs 760).
    expect((await as(t, shop.admin).get(`/v1/suppliers/${supplier}`)).body.balancePaise).toBe(
      124_000,
    );

    const second = await postWithKey(t, shop.admin, '/v1/supplier-returns', {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      reason: 'Wrong flavour',
      lines: [{ productId: product, qty: 1, unitCreditPaise: 20_000 }],
    });
    expect(second.body.debitNoteNo).toBe('DN-0002');
    expect(
      (await as(t, shop.admin).get('/v1/supplier-returns')).body.items.map(
        (r: { debitNoteNo: string }) => r.debitNoteNo,
      ),
    ).toEqual(['DN-0002', 'DN-0001']);
    expect(
      (await as(t, shop.admin).get(`/v1/supplier-returns/${res.body.id}`)).body.debitNoteNo,
    ).toBe('DN-0001');
    expect(await auditActions(shop.owner.tenantId)).toContain('supplier_return.created');
  });

  it('refuse more than is on hand, save nothing (not even a debit note number), and a retry works once stock exists', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 2, unitCostPaise: 1_000 }],
    });
    const body = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      reason: 'Too many',
      lines: [{ productId: product, qty: 6, unitCreditPaise: 1_000 }],
    };
    const refused = await postWithKey(t, shop.admin, '/v1/supplier-returns', body);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('INSUFFICIENT_STOCK');
    expect(
      await t.db.owner.supplierReturn.count({ where: { tenantId: shop.owner.tenantId } }),
    ).toBe(0);
    expect((await stockOf(t, shop.admin, shop.mainBranchId, product)).qty).toBe(2);
    // The failed attempt took no debit note number: the next real one is DN-0001.
    const ok = await postWithKey(t, shop.admin, '/v1/supplier-returns', {
      ...body,
      lines: [{ productId: product, qty: 2, unitCreditPaise: 1_000 }],
    });
    expect(ok.body.debitNoteNo).toBe('DN-0001');
    expect(await stockOf(t, shop.admin, shop.mainBranchId, product)).toMatchObject({
      qty: 0,
      valuePaise: 0,
    });
  });

  it('can send back from one named batch, and a retry with the same key makes one debit note', async () => {
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
          batchNo: 'OLD',
          expiryDate: daysFromToday(t, 30),
        },
        {
          productId: product,
          qty: 5,
          unitCostPaise: 1_000,
          batchNo: 'NEW',
          expiryDate: daysFromToday(t, 300),
        },
      ],
    });
    const newer = await t.db.owner.stockBatch.findFirstOrThrow({
      where: { productId: product, batchNo: 'NEW' },
    });
    const key = randomUUID();
    const body = {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      reason: 'Wrong lot',
      lines: [{ productId: product, batchId: newer.id, qty: 3, unitCreditPaise: 1_000 }],
    };
    const first = await postWithKey(t, shop.admin, '/v1/supplier-returns', body, key);
    const again = await postWithKey(t, shop.admin, '/v1/supplier-returns', body, key);
    expect(again.body).toEqual(first.body);
    expect(
      await t.db.owner.supplierReturn.count({ where: { tenantId: shop.owner.tenantId } }),
    ).toBe(1);
    const batches = await t.db.owner.stockBatch.findMany({
      where: { productId: product },
      orderBy: { batchNo: 'asc' },
    });
    expect(batches.map((b) => [b.batchNo, b.qtyRemaining])).toEqual([
      ['NEW', 2],
      ['OLD', 5],
    ]);
  });

  it('need purchases.write, and another business cannot read them', async () => {
    const shop = await makeShop(t);
    const other = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 2, unitCostPaise: 1_000 }],
    });
    const made = await postWithKey(t, shop.admin, '/v1/supplier-returns', {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      reason: 'Back',
      lines: [{ productId: product, qty: 1, unitCreditPaise: 1_000 }],
    });
    expect((await as(t, shop.cashier).get('/v1/supplier-returns')).status).toBe(403);
    expect((await postWithKey(t, shop.cashier, '/v1/supplier-returns', {})).status).toBe(403);
    expect((await as(t, other.admin).get(`/v1/supplier-returns/${made.body.id}`)).status).toBe(404);
    expect((await as(t, other.admin).get('/v1/supplier-returns')).body.items).toHaveLength(0);
  });
});
