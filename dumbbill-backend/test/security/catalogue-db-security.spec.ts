import { uuid7 } from '../../src/common/uuid7';
import { createTestDatabase, TestDatabase } from '../support/test-database';

/**
 * Database-level guarantees behind the catalogue (P1-4), checked as the restricted app role (what the running API uses)
 * and as the owner (for rules that must hold whatever code runs). The HTTP tests prove the features; these prove the
 * walls hold even if application code is wrong: businesses cannot see each other's products or prices, the price history
 * can only ever be added to, and nonsense values cannot be stored.
 */
let db: TestDatabase;
const tenantA = uuid7();
const tenantB = uuid7();
let productA = '';
let productB = '';

beforeAll(async () => {
  db = await createTestDatabase();
  for (const [tenantId, label] of [
    [tenantA, 'a'],
    [tenantB, 'b'],
  ] as const) {
    await db.owner.tenant.create({ data: { id: tenantId, name: `Business ${label}` } });
    const product = await db.owner.product.create({
      data: {
        tenantId,
        name: 'Whey',
        barcode: '123456',
        prices: {
          create: {
            tenantId,
            mrpPaise: 100_000,
            pricePaise: 90_000,
            effectiveFrom: new Date(),
            reason: 'Initial price',
          },
        },
      },
    });
    if (label === 'a') productA = product.id;
    else productB = product.id;
  }
});

afterAll(async () => {
  await db.drop();
});

describe('categories, products and prices are walled off per business', () => {
  it.each(['product_categories', 'products', 'price_history'])(
    'with business A selected, %s shows nothing of business B',
    async (table) => {
      const rows = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(`SELECT tenant_id FROM ${table}`),
      );
      if (table !== 'product_categories') expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.tenant_id === tenantA)).toBe(true);
    },
  );

  it('with no business selected they are empty', async () => {
    for (const table of ['product_categories', 'products', 'price_history']) {
      expect(await db.app.$queryRawUnsafe(`SELECT 1 FROM ${table}`)).toEqual([]);
    }
  });

  it("business A cannot change or delete business B's product, or add a price to it, even by guessing ids", async () => {
    const changed = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.product.updateMany({ where: { id: productB }, data: { name: 'Hacked' } }),
    );
    const deleted = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.product.deleteMany({ where: { id: productB } }),
    );
    expect(changed.count).toBe(0);
    expect(deleted.count).toBe(0);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.priceHistory.create({
          data: {
            tenantId: tenantB,
            productId: productB,
            mrpPaise: 100,
            pricePaise: 1,
            effectiveFrom: new Date(),
            reason: 'steal',
          },
        }),
      ),
    ).rejects.toThrow();
    expect((await db.owner.product.findUniqueOrThrow({ where: { id: productB } })).name).toBe(
      'Whey',
    );
  });
});

describe('the price history can only be added to', () => {
  it('refuses the app role changing or deleting a price row', async () => {
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.priceHistory.updateMany({ where: { productId: productA }, data: { pricePaise: 1 } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.priceHistory.deleteMany({ where: { productId: productA } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('also refuses the table OWNER (a script with the owner password), by a trigger', async () => {
    await expect(
      db.owner.priceHistory.updateMany({
        where: { productId: productA },
        data: { reason: 'edited' },
      }),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.owner.priceHistory.deleteMany({ where: { productId: productA } }),
    ).rejects.toThrow(/append-only/i);
    expect(await db.owner.priceHistory.count({ where: { productId: productA } })).toBe(1);
  });

  it('still lets the app role add rows', async () => {
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.priceHistory.create({
          data: {
            tenantId: tenantA,
            productId: productA,
            mrpPaise: 100_000,
            pricePaise: 80_000,
            effectiveFrom: new Date(),
            reason: 'Sale',
          },
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('values the database refuses whatever code writes them', () => {
  const product = (overrides: Record<string, unknown> = {}) => ({
    tenantId: tenantA,
    name: `Item ${Math.random()}`,
    ...overrides,
  });

  it('a barcode of the wrong shape, and the same barcode twice in one business (but not across businesses)', async () => {
    await expect(db.owner.product.create({ data: product({ barcode: 'a b' }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(db.owner.product.create({ data: product({ barcode: '123456' }) })).rejects.toThrow(
      /unique/i,
    );
    await expect(
      db.owner.product.create({ data: product({ tenantId: tenantB, barcode: '654321' }) }),
    ).resolves.toBeDefined();
  });

  it('an HSN that is not 4, 6 or 8 digits', async () => {
    for (const hsn of ['210', '21069', '2106909', 'abcd'])
      await expect(db.owner.product.create({ data: product({ hsn }) })).rejects.toThrow(
        /check constraint/i,
      );
    for (const hsn of ['2106', '210690', '21069099'])
      await expect(db.owner.product.create({ data: product({ hsn }) })).resolves.toBeDefined();
  });

  it('a GST rate outside 0 to 100 percent, a negative cost, and a blank name', async () => {
    await expect(db.owner.product.create({ data: product({ gstRateBp: 10_001 }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      db.owner.product.create({ data: product({ purchaseCostPaise: -1 }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(db.owner.product.create({ data: product({ name: '  ' }) })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('a price above the MRP, a zero price, and a blank reason', async () => {
    const price = (overrides: Record<string, unknown>) => ({
      tenantId: tenantA,
      productId: productA,
      mrpPaise: 1_000,
      pricePaise: 900,
      effectiveFrom: new Date(),
      reason: 'ok',
      ...overrides,
    });
    await expect(
      db.owner.priceHistory.create({ data: price({ pricePaise: 1_001 }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(db.owner.priceHistory.create({ data: price({ pricePaise: 0 }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(db.owner.priceHistory.create({ data: price({ reason: ' ' }) })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('the same name + brand + variant twice in one business', async () => {
    await expect(
      db.owner.product.create({ data: { tenantId: tenantA, name: 'Whey' } }),
    ).rejects.toThrow(/unique/i);
  });

  it('a product or category that others still refer to cannot be deleted', async () => {
    await expect(db.owner.product.delete({ where: { id: productA } })).rejects.toThrow();
  });
});
