import { randomUUID } from 'node:crypto';
import { AuthTestApp } from './auth-test-app';
import { addTeamMember, as, createBusiness, Person } from './team-helpers';

/**
 * Building blocks for the purchasing and stock tests: a business with two branches (Growth plan), an admin and a
 * cashier, products, suppliers, and calls that carry a fresh Idempotency-Key. Everything goes through the real HTTP API.
 */

let counter = 0;

/** A business on the Growth plan (three branches) with its owner, an admin and a cashier (assigned to the main branch only). */
export interface Shop {
  owner: Person;
  admin: Person;
  /** Read-only till staff: products.read, assigned to the main branch only. */
  cashier: Person;
  mainBranchId: string;
  secondBranchId: string;
}

/** Make the Growth plan available. Call once in `beforeAll`, after the app exists. */
export async function seedGrowthPlan(t: AuthTestApp): Promise<void> {
  await t.db.owner.plan.create({
    data: { code: 'GROWTH', name: 'Growth', maxBranches: 3, maxUsers: 25, trialDays: 14 },
  });
}

export async function makeShop(t: AuthTestApp): Promise<Shop> {
  const owner = await createBusiness(t);
  const plan = await t.db.owner.plan.findUniqueOrThrow({ where: { code: 'GROWTH' } });
  await t.db.owner.tenant.update({ where: { id: owner.tenantId }, data: { planId: plan.id } });
  const main = (await t.db.owner.branch.findFirstOrThrow({ where: { tenantId: owner.tenantId } }))
    .id;
  const second = await as(t, owner).post('/v1/branches', {
    name: 'Baner shop',
    invoicePrefix: 'BAN',
    printerWidthMm: 80,
    stateCode: '27',
  });
  if (second.status !== 201) throw new Error(`second branch failed: ${second.status}`);
  const admin = await addTeamMember(t, owner, 'ADMIN');
  const cashier = await addTeamMember(t, owner, 'CASHIER', { branchIds: [main] });
  return { owner, admin, cashier, mainBranchId: main, secondBranchId: second.body.id };
}

/** A product with a unique name and barcode. Returns its id. */
export async function newProduct(
  t: AuthTestApp,
  person: Person,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  counter += 1;
  const res = await as(t, person).post('/v1/products', {
    name: `Test whey ${counter}`,
    brand: 'Dumbbill',
    variant: '1 kg',
    barcode: `BC${String(Date.now()).slice(-8)}${counter}`,
    mrpPaise: 500_000,
    pricePaise: 400_000,
    ...overrides,
  });
  if (res.status !== 201)
    throw new Error(`product failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

export async function newSupplier(
  t: AuthTestApp,
  person: Person,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  counter += 1;
  const res = await as(t, person).post('/v1/suppliers', {
    name: `Nutri Distributors ${counter}`,
    ...overrides,
  });
  if (res.status !== 201)
    throw new Error(`supplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** POST with an Idempotency-Key header (a fresh key unless one is given). */
export function postWithKey(
  t: AuthTestApp,
  person: Pick<Person, 'accessToken'>,
  path: string,
  body: object,
  key: string | null = randomUUID(),
) {
  const request = t
    .http()
    .post(path)
    .set('Authorization', `Bearer ${person.accessToken}`)
    .set('X-Forwarded-For', t.freshIp());
  if (key !== null) request.set('Idempotency-Key', key);
  return request.send(body);
}

/** Record a purchase at a branch and return the saved purchase. Fails the test if it is refused. */
export async function buy(
  t: AuthTestApp,
  person: Person,
  args: {
    supplierId: string;
    branchId: string;
    lines: Array<{
      productId: string;
      qty: number;
      unitCostPaise: number;
      batchNo?: string;
      expiryDate?: string;
    }>;
    otherCostPaise?: number;
    invoiceRef?: string;
  },
) {
  counter += 1;
  const res = await postWithKey(t, person, '/v1/purchases', {
    supplierId: args.supplierId,
    branchId: args.branchId,
    invoiceRef: args.invoiceRef ?? `INV-${counter}-${Date.now()}`,
    invoiceDate: new Date(t.clock.now().getTime() + 330 * 60_000).toISOString().slice(0, 10),
    otherCostPaise: args.otherCostPaise ?? 0,
    lines: args.lines,
  });
  if (res.status !== 201)
    throw new Error(`purchase failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** The stock row of one product at a branch, as the admin sees it (with cost). */
export async function stockOf(
  t: AuthTestApp,
  person: Person,
  branchId: string,
  productId: string,
): Promise<{
  qty: number;
  wacPaise?: number;
  valuePaise?: number;
  minQty: number | null;
  isLow: boolean;
}> {
  const res = await as(t, person).get(`/v1/stock?branchId=${branchId}&limit=200`);
  if (res.status !== 200)
    throw new Error(`stock failed: ${res.status} ${JSON.stringify(res.body)}`);
  const row = res.body.items.find((item: { productId: string }) => item.productId === productId);
  if (!row) throw new Error('product not in the stock list');
  return row;
}

/** A calendar date "YYYY-MM-DD" that many days from today in India, by the test clock. */
export function daysFromToday(t: AuthTestApp, days: number): string {
  const date = new Date(t.clock.now().getTime() + 330 * 60_000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
