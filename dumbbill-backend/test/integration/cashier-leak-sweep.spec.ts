import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import {
  buy,
  daysFromToday,
  makeShop,
  newProduct,
  newSupplier,
  seedGrowthPlan,
  Shop,
} from '../support/inventory-helpers';
import { discoverRoutes } from '../support/route-discovery';
import { as } from '../support/team-helpers';

/**
 * THE CASHIER LEAK SWEEP (hard rule 3: cost secrecy).
 *
 * A cashier must never see what anything cost or what was earned. Module tests check the screens we thought of; this one
 * is generated from the running app: it calls EVERY read route a cashier is allowed to call, with real records that carry
 * real costs behind them (a product with a purchase cost and a bought batch), and fails if any answer contains a field or
 * value that reveals cost, margin, profit or landed cost. A new read route that leaks is caught the day it is written,
 * with no need to remember to add a test.
 */

let t: AuthTestApp;
let shop: Shop;
let params: Record<string, string>;

/** Field names that reveal cost or profit. (Keys are checked, not values, so a product called "Cost-effective" is fine.) */
const COST_WORDS = /cost|wac|cogs|margin|profit|landed|valuepaise|unitcredit|balancepaise/i;

/** The distinctive purchase cost used below, as a number a leak would show up as. */
const SECRET_COST_PAISE = 123_457;

beforeAll(async () => {
  t = await createAuthTestApp();
  await seedGrowthPlan(t);
  shop = await makeShop(t);
  const productId = await newProduct(t, shop.owner, {
    barcode: 'LEAK-BARCODE-1',
    purchaseCostPaise: SECRET_COST_PAISE,
  });
  const supplierId = await newSupplier(t, shop.owner);
  const purchase = await buy(t, shop.owner, {
    supplierId,
    branchId: shop.mainBranchId,
    lines: [
      {
        productId,
        qty: 10,
        unitCostPaise: SECRET_COST_PAISE,
        batchNo: 'LEAK1',
        expiryDate: daysFromToday(t, 90),
      },
    ],
  });
  params = {
    productId,
    barcode: 'LEAK-BARCODE-1',
    branchId: shop.mainBranchId,
    supplierId,
    purchaseId: purchase.id,
  };
});

afterAll(async () => {
  await t.close();
});

/** Every key name at any depth in a JSON value. */
function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) keysOf(item, found);
  else if (value && typeof value === 'object')
    for (const [key, inner] of Object.entries(value)) {
      found.push(key);
      keysOf(inner, found);
    }
  return found;
}

describe('every read route a cashier can reach', () => {
  it('shows no cost, margin or profit anywhere (field names, or the secret cost value)', async () => {
    const cashierPermissions = new Set(
      (await as(t, shop.cashier).get('/v1/auth/me')).body.access.permissions as string[],
    );
    const routes = discoverRoutes(t.app).filter(
      (route) =>
        route.method === 'GET' &&
        (route.rule.kind === 'authenticated' ||
          (route.rule.kind === 'permission' &&
            route.rule.permissions.every((key) => cashierPermissions.has(key)))),
    );
    expect(routes.length).toBeGreaterThan(5);

    const leaks: string[] = [];
    const reachedRoutes: string[] = [];
    for (const route of routes) {
      // A route parameter this test has no real record for would silently become a 404 and the route would stop
      // being scanned; fail loudly instead so a renamed parameter is noticed.
      const path = route.path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
        const value = params[name];
        if (value === undefined) leaks.push(`${route.path}: no test record for :${name}`);
        return value ?? '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
      });
      const query = path.startsWith('/v1/stock') ? `?branchId=${params.branchId}` : '';
      const res = await as(t, shop.cashier).get(`${path}${query}`);
      if (res.status !== 200) continue; // refused or empty: nothing was shown
      reachedRoutes.push(route.path);
      const badKeys = keysOf(res.body).filter((key) => COST_WORDS.test(key));
      if (badKeys.length > 0)
        leaks.push(`${route.path}: field(s) ${[...new Set(badKeys)].join(', ')}`);
      if (JSON.stringify(res.body).includes(String(SECRET_COST_PAISE)))
        leaks.push(`${route.path}: contains the secret cost value`);
    }
    // The sweep must really have looked at the screens that carry cost for the owner, not skipped them.
    expect(reachedRoutes).toEqual(
      expect.arrayContaining([
        '/v1/products',
        '/v1/products/:productId',
        '/v1/products/by-barcode/:barcode',
        '/v1/stock',
      ]),
    );
    expect(leaks).toEqual([]);
  });

  it('(control) the owner DOES get cost on the same product, so the scan is capable of finding it', async () => {
    const res = await as(t, shop.owner).get(`/v1/products/${params.productId}`);
    expect(res.status).toBe(200);
    expect(keysOf(res.body).some((key) => COST_WORDS.test(key))).toBe(true);
  });
});
