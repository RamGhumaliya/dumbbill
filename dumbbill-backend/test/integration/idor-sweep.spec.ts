import { randomUUID } from 'node:crypto';
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
} from '../support/inventory-helpers';
import { discoverRoutes } from '../support/route-discovery';
import { addTeamMember, as } from '../support/team-helpers';

/**
 * THE CROSS-BUSINESS SWEEP (IDOR = "insecure direct object reference": guessing or reusing another customer's id).
 *
 * Business A owns real records of every kind. Business B's owner, who is fully trusted INSIDE B, then tries every
 * route that takes an id, in the address, in the body or in the query, using A's real ids. The rule (hard rule 1):
 * another business's record answers exactly like a record that does not exist, 404 where the id names the thing being
 * fetched, a refusal (never a success) where it is only referred to inside a form. Afterwards A's data must be exactly
 * as it was, and nothing about A may appear in what B was told.
 *
 * The first test makes the sweep complete: it lists every route with an id in its address from the running app and
 * fails when one is missing from the table below, so a new route cannot slip past without being added here.
 */

/** A valid 1x1 PNG, so the picture route gets past the file check and must then look the product up. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let t: AuthTestApp;
let a: Shop;
let b: Shop;

/** Real ids owned by business A. */
interface Records {
  productId: string;
  barcode: string;
  supplierId: string;
  purchaseId: string;
  returnId: string;
  transferId: string;
  roleId: string;
  memberId: string;
  sessionId: string;
  batchId: string;
}
let ids: Records;
/** One of B's own products, so that in the form probes below A's id is the ONLY thing that is wrong. */
let bProductId: string;

beforeAll(async () => {
  t = await createAuthTestApp();
  await seedGrowthPlan(t);
  a = await makeShop(t);
  b = await makeShop(t);
  bProductId = await newProduct(t, b.owner);

  const productId = await newProduct(t, a.owner, { barcode: 'A-ONLY-BARCODE-1' });
  const supplierId = await newSupplier(t, a.owner, { name: 'Alpha Only Distributors' });
  const purchase = await buy(t, a.owner, {
    supplierId,
    branchId: a.mainBranchId,
    lines: [
      {
        productId,
        qty: 20,
        unitCostPaise: 250_000,
        batchNo: 'ALPHA1',
        expiryDate: daysFromToday(t, 200),
      },
    ],
  });
  const batch = await t.db.owner.stockBatch.findFirstOrThrow({
    where: { tenantId: a.owner.tenantId, productId },
  });
  const ret = await postWithKey(t, a.owner, '/v1/supplier-returns', {
    supplierId,
    branchId: a.mainBranchId,
    reason: 'Damaged in transit',
    lines: [{ productId, qty: 1, unitCreditPaise: 250_000 }],
  });
  const transfer = await postWithKey(t, a.owner, '/v1/stock/transfers', {
    fromBranchId: a.mainBranchId,
    toBranchId: a.secondBranchId,
    lines: [{ productId, qty: 2 }],
  });
  const role = await as(t, a.owner).post('/v1/team/roles', {
    name: 'Alpha counter staff',
    permissions: ['products.read'],
  });
  const sessions = await as(t, a.owner).get('/v1/auth/sessions');
  if (ret.status !== 201 || transfer.status !== 201 || role.status !== 201)
    throw new Error('setting up business A failed');
  ids = {
    productId,
    barcode: 'A-ONLY-BARCODE-1',
    supplierId,
    purchaseId: purchase.id,
    returnId: ret.body.id,
    transferId: transfer.body.id,
    roleId: role.body.id,
    memberId: a.admin.userId,
    sessionId: sessions.body.sessions[0].id,
    batchId: batch.id,
  };
});

afterAll(async () => {
  await t.close();
});

/** A request B's owner makes against one of A's records. */
interface Probe {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** The route as declared, for example `/v1/products/:productId`. Only set for id-in-address probes. */
  route?: string;
  path: (r: Records) => string;
  body?: (r: Records) => object;
  /** Send a small picture as a multipart `file` field (for the picture upload route). */
  upload?: boolean;
}

/** Every route with an id in the ADDRESS. The first test proves this list is complete. */
const ADDRESS_PROBES: Probe[] = [
  {
    method: 'delete',
    route: '/v1/auth/sessions/:sessionId',
    path: (r) => `/v1/auth/sessions/${r.sessionId}`,
  },
  { method: 'get', route: '/v1/branches/:branchId', path: () => `/v1/branches/${a.mainBranchId}` },
  {
    method: 'put',
    route: '/v1/branches/:branchId',
    path: () => `/v1/branches/${a.mainBranchId}`,
    body: () => ({ name: 'Hijacked', invoicePrefix: 'HAX', printerWidthMm: 80, stateCode: '27' }),
  },
  {
    method: 'post',
    route: '/v1/branches/:branchId/deactivate',
    path: () => `/v1/branches/${a.secondBranchId}/deactivate`,
  },
  {
    method: 'post',
    route: '/v1/branches/:branchId/activate',
    path: () => `/v1/branches/${a.secondBranchId}/activate`,
  },
  {
    method: 'get',
    route: '/v1/products/by-barcode/:barcode',
    path: (r) => `/v1/products/by-barcode/${r.barcode}`,
  },
  { method: 'get', route: '/v1/products/:productId', path: (r) => `/v1/products/${r.productId}` },
  {
    method: 'put',
    route: '/v1/products/:productId',
    path: (r) => `/v1/products/${r.productId}`,
    body: () => ({ name: 'Hijacked' }),
  },
  {
    method: 'post',
    route: '/v1/products/:productId/deactivate',
    path: (r) => `/v1/products/${r.productId}/deactivate`,
  },
  {
    method: 'post',
    route: '/v1/products/:productId/activate',
    path: (r) => `/v1/products/${r.productId}/activate`,
  },
  {
    method: 'get',
    route: '/v1/products/:productId/prices',
    path: (r) => `/v1/products/${r.productId}/prices`,
  },
  {
    method: 'post',
    route: '/v1/products/:productId/prices',
    path: (r) => `/v1/products/${r.productId}/prices`,
    body: () => ({ mrpPaise: 100, pricePaise: 1, reason: 'Hijack attempt' }),
  },
  {
    method: 'put',
    route: '/v1/products/:productId/image',
    path: (r) => `/v1/products/${r.productId}/image`,
    upload: true,
  },
  {
    method: 'get',
    route: '/v1/products/:productId/image',
    path: (r) => `/v1/products/${r.productId}/image`,
  },
  {
    method: 'delete',
    route: '/v1/products/:productId/image',
    path: (r) => `/v1/products/${r.productId}/image`,
  },
  {
    method: 'get',
    route: '/v1/stock/transfers/:transferId',
    path: (r) => `/v1/stock/transfers/${r.transferId}`,
  },
  {
    method: 'post',
    route: '/v1/stock/transfers/:transferId/receive',
    path: (r) => `/v1/stock/transfers/${r.transferId}/receive`,
  },
  {
    method: 'post',
    route: '/v1/stock/transfers/:transferId/cancel',
    path: (r) => `/v1/stock/transfers/${r.transferId}/cancel`,
  },
  {
    method: 'get',
    route: '/v1/suppliers/:supplierId',
    path: (r) => `/v1/suppliers/${r.supplierId}`,
  },
  {
    method: 'put',
    route: '/v1/suppliers/:supplierId',
    path: (r) => `/v1/suppliers/${r.supplierId}`,
    body: () => ({ name: 'Hijacked' }),
  },
  {
    method: 'post',
    route: '/v1/suppliers/:supplierId/deactivate',
    path: (r) => `/v1/suppliers/${r.supplierId}/deactivate`,
  },
  {
    method: 'post',
    route: '/v1/suppliers/:supplierId/activate',
    path: (r) => `/v1/suppliers/${r.supplierId}/activate`,
  },
  {
    method: 'get',
    route: '/v1/purchases/:purchaseId',
    path: (r) => `/v1/purchases/${r.purchaseId}`,
  },
  {
    method: 'get',
    route: '/v1/supplier-returns/:returnId',
    path: (r) => `/v1/supplier-returns/${r.returnId}`,
  },
  {
    method: 'patch',
    route: '/v1/team/roles/:roleId',
    path: (r) => `/v1/team/roles/${r.roleId}`,
    body: () => ({ permissions: [] }),
  },
  { method: 'delete', route: '/v1/team/roles/:roleId', path: (r) => `/v1/team/roles/${r.roleId}` },
  {
    method: 'get',
    route: '/v1/team/members/:memberId',
    path: (r) => `/v1/team/members/${r.memberId}`,
  },
  {
    method: 'patch',
    route: '/v1/team/members/:memberId',
    path: (r) => `/v1/team/members/${r.memberId}`,
    body: () => ({ fullName: 'Hijacked' }),
  },
  {
    method: 'post',
    route: '/v1/team/members/:memberId/disable',
    path: (r) => `/v1/team/members/${r.memberId}/disable`,
  },
  {
    method: 'post',
    route: '/v1/team/members/:memberId/enable',
    path: (r) => `/v1/team/members/${r.memberId}/enable`,
  },
  {
    method: 'post',
    route: '/v1/team/members/:memberId/resend-invitation',
    path: (r) => `/v1/team/members/${r.memberId}/resend-invitation`,
  },
];

/** Routes that only REFER to another business's record inside a form or a filter (id in the body or query). */
const REFERENCE_PROBES: Array<{
  label: string;
  send: (r: Records) => Promise<{ status: number; body: unknown }>;
}> = [
  {
    label: "stock list of A's branch",
    send: () => as(t, b.owner).get(`/v1/stock?branchId=${a.mainBranchId}`),
  },
  {
    label: "stock ledger of A's branch",
    send: (r) =>
      as(t, b.owner).get(`/v1/stock/ledger?branchId=${a.mainBranchId}&productId=${r.productId}`),
  },
  {
    label: "stock alerts of A's branch",
    send: () => as(t, b.owner).get(`/v1/stock/alerts?branchId=${a.mainBranchId}`),
  },
  {
    label: "a count of A's product",
    send: (r) =>
      postWithKey(t, b.owner, '/v1/stock/adjustments', {
        branchId: b.mainBranchId,
        productId: r.productId,
        countedQty: 500,
        reason: 'RECOUNT',
      }),
  },
  {
    label: "a count in A's branch",
    send: () =>
      postWithKey(t, b.owner, '/v1/stock/adjustments', {
        branchId: a.mainBranchId,
        productId: bProductId,
        countedQty: 500,
        reason: 'RECOUNT',
      }),
  },
  {
    label: "a write-off of A's batch",
    send: (r) =>
      postWithKey(t, b.owner, '/v1/stock/write-offs', {
        branchId: b.mainBranchId,
        batchId: r.batchId,
      }),
  },
  {
    label: "a low-stock level on A's product",
    send: (r) =>
      as(t, b.owner).put('/v1/stock/thresholds', {
        branchId: b.mainBranchId,
        productId: r.productId,
        minQty: 3,
      }),
  },
  {
    label: "a purchase from A's supplier",
    send: (r) =>
      postWithKey(t, b.owner, '/v1/purchases', {
        supplierId: r.supplierId,
        branchId: b.mainBranchId,
        invoiceRef: 'X-1',
        invoiceDate: daysFromToday(t, 0),
        otherCostPaise: 0,
        lines: [{ productId: bProductId, qty: 1, unitCostPaise: 100 }],
      }),
  },
  {
    label: "a purchase of A's product",
    send: async (r) => {
      const supplier = await newSupplier(t, b.owner);
      return postWithKey(t, b.owner, '/v1/purchases', {
        supplierId: supplier,
        branchId: b.mainBranchId,
        invoiceRef: 'X-2',
        invoiceDate: daysFromToday(t, 0),
        otherCostPaise: 0,
        lines: [{ productId: r.productId, qty: 1, unitCostPaise: 100 }],
      });
    },
  },
  {
    label: "a purchase into A's branch",
    send: async () => {
      const supplier = await newSupplier(t, b.owner);
      const product = await newProduct(t, b.owner);
      return postWithKey(t, b.owner, '/v1/purchases', {
        supplierId: supplier,
        branchId: a.mainBranchId,
        invoiceRef: 'X-3',
        invoiceDate: daysFromToday(t, 0),
        otherCostPaise: 0,
        lines: [{ productId: product, qty: 1, unitCostPaise: 100 }],
      });
    },
  },
  {
    label: "a supplier return to A's supplier",
    send: (r) =>
      postWithKey(t, b.owner, '/v1/supplier-returns', {
        supplierId: r.supplierId,
        branchId: b.mainBranchId,
        reason: 'Hijack attempt',
        lines: [{ productId: bProductId, qty: 1, unitCreditPaise: 100 }],
      }),
  },
  {
    label: "a transfer out of A's branch",
    send: (r) =>
      postWithKey(t, b.owner, '/v1/stock/transfers', {
        fromBranchId: a.mainBranchId,
        toBranchId: b.mainBranchId,
        lines: [{ productId: r.productId, qty: 1 }],
      }),
  },
  {
    label: "a transfer into A's branch",
    send: async () => {
      const product = await newProduct(t, b.owner);
      return postWithKey(t, b.owner, '/v1/stock/transfers', {
        fromBranchId: b.mainBranchId,
        toBranchId: a.mainBranchId,
        lines: [{ productId: product, qty: 1 }],
      });
    },
  },
  {
    label: "inviting a person into A's role",
    send: (r) =>
      as(t, b.owner).post('/v1/team/members', {
        email: 'intruder@beta.test',
        fullName: 'Intruder',
        roleId: r.roleId,
      }),
  },
  {
    label: "inviting a person into A's branch",
    send: (r) =>
      as(t, b.owner).post('/v1/team/members', {
        email: 'intruder2@beta.test',
        fullName: 'Intruder',
        roleId: r.roleId,
        branchIds: [a.mainBranchId],
      }),
  },
];

/** A snapshot of everything the sweep could have damaged in business A. */
async function snapshotOfA(): Promise<unknown> {
  const tenantId = a.owner.tenantId;
  const db = t.db.owner;
  return {
    products: await db.product.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    prices: await db.priceHistory.count({ where: { tenantId } }),
    suppliers: await db.supplier.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    purchases: await db.purchase.count({ where: { tenantId } }),
    returns: await db.supplierReturn.count({ where: { tenantId } }),
    transfers: await db.stockTransfer.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    ledger: await db.stockLedger.count({ where: { tenantId } }),
    levels: await db.stockLevel.findMany({ where: { tenantId }, orderBy: { productId: 'asc' } }),
    thresholds: await db.stockThreshold.findMany({ where: { tenantId } }),
    branches: await db.branch.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    roles: await db.role.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    users: await db.user.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    sessionsRevoked: await db.session.count({ where: { tenantId, revokedAt: { not: null } } }),
  };
}

describe('the sweep is complete', () => {
  it('lists every route with an id in its address, and every one has a probe', () => {
    const declared = discoverRoutes(t.app)
      .filter((route) => route.path.includes(':'))
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    const probed = ADDRESS_PROBES.map((p) => `${p.method.toUpperCase()} ${p.route}`).sort();
    expect(declared).toEqual(probed);
  });
});

describe("business B using business A's real ids", () => {
  let before: unknown;
  const answers: string[] = [];

  beforeAll(async () => {
    before = await snapshotOfA();
  });

  it.each(ADDRESS_PROBES.map((p) => [`${p.method.toUpperCase()} ${p.route}`, p] as const))(
    'id in the address: %s answers 404, not 403 and not data',
    async (_label, probe) => {
      const res = probe.upload
        ? await t
            .http()
            .put(probe.path(ids))
            .set('Authorization', `Bearer ${b.owner.accessToken}`)
            .set('X-Forwarded-For', t.freshIp())
            .attach('file', TINY_PNG, { filename: 'p.png', contentType: 'image/png' })
        : await as(t, b.owner)[probe.method](
            probe.path(ids),
            ...(probe.body ? [probe.body(ids)] : []),
          );
      expect(res.status).toBe(404);
      answers.push(JSON.stringify(res.body));
    },
  );

  it.each(REFERENCE_PROBES.map((p) => [p.label, p] as const))(
    'id in a form or filter: %s is refused and nothing happens',
    async (_label, probe) => {
      const res = await probe.send(ids);
      // 400 (field names the unknown thing), 403 (not B's branch) or 404; never a success.
      expect([400, 403, 404, 422]).toContain(res.status);
      answers.push(JSON.stringify(res.body));
    },
  );

  it("a filter by A's supplier or person finds nothing (an empty list, never A's rows)", async () => {
    for (const path of [
      `/v1/purchases?supplierId=${ids.supplierId}`,
      `/v1/audit?actorUserId=${ids.memberId}`,
    ]) {
      const res = await as(t, b.owner).get(path);
      expect(res.status).toBe(200);
      expect(res.body.items ?? res.body.entries).toEqual([]);
      answers.push(JSON.stringify(res.body));
    }
  });

  it("a branch filter naming A's branch is a 404, as for every other branch-bound route", async () => {
    for (const path of [
      `/v1/purchases?branchId=${a.mainBranchId}`,
      `/v1/stock/alerts?branchId=${a.mainBranchId}`,
    ]) {
      const res = await as(t, b.owner).get(path);
      expect(res.status).toBe(404);
      answers.push(JSON.stringify(res.body));
    }
  });

  it('nothing about business A appears in anything B was told', () => {
    const everything = answers.join('\n');
    for (const secret of [
      'Alpha Only Distributors',
      'ALPHA1',
      'A-ONLY-BARCODE-1',
      'Alpha counter staff',
      a.owner.email,
      a.admin.email,
    ])
      expect(everything).not.toContain(secret);
  });

  it("business A's data is exactly as it was", async () => {
    expect(await snapshotOfA()).toEqual(before);
    // A can still use their own session and see their own records.
    expect((await as(t, a.owner).get(`/v1/products/${ids.productId}`)).status).toBe(200);
    expect((await as(t, a.owner).get('/v1/auth/me')).status).toBe(200);
  });

  it("the same Idempotency-Key used by two businesses never replays the other's answer", async () => {
    const key = randomUUID();
    const productA = await newProduct(t, a.owner);
    const first = await postWithKey(
      t,
      a.owner,
      '/v1/stock/adjustments',
      { branchId: a.mainBranchId, productId: productA, countedQty: 4, reason: 'RECOUNT' },
      key,
    );
    expect(first.status).toBe(201);
    const productB = await newProduct(t, b.owner);
    const second = await postWithKey(
      t,
      b.owner,
      '/v1/stock/adjustments',
      { branchId: b.mainBranchId, productId: productB, countedQty: 9, reason: 'RECOUNT' },
      key,
    );
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(second.body.qtyAfter).toBe(9);
  });
});

describe('inside one business, a person limited to one branch', () => {
  it('cannot reach the other branch through any branch-bound route', async () => {
    // A Cashier is limited to the branches assigned to them (the Admin role covers every branch). Extra permissions
    // give them every branch-bound capability so the test proves the BRANCH wall, not a missing permission.
    const limited = await addTeamMember(
      t,
      a.owner,
      'CASHIER',
      {
        branchIds: [a.mainBranchId],
        extraPermissions: ['stock.adjust', 'stock.transfer', 'purchases.write'],
      },
      'limited',
    );
    const call = as(t, limited);
    const other = a.secondBranchId;
    const results = {
      stock: await call.get(`/v1/stock?branchId=${other}`),
      ledger: await call.get(`/v1/stock/ledger?branchId=${other}`),
      alerts: await call.get(`/v1/stock/alerts?branchId=${other}`),
      count: await postWithKey(t, limited, '/v1/stock/adjustments', {
        branchId: other,
        productId: ids.productId,
        countedQty: 1,
        reason: 'RECOUNT',
      }),
      purchase: await postWithKey(t, limited, '/v1/purchases', {
        supplierId: ids.supplierId,
        branchId: other,
        invoiceRef: 'LIM-1',
        invoiceDate: daysFromToday(t, 0),
        otherCostPaise: 0,
        lines: [{ productId: ids.productId, qty: 1, unitCostPaise: 100 }],
      }),
      transferFrom: await postWithKey(t, limited, '/v1/stock/transfers', {
        fromBranchId: other,
        toBranchId: a.mainBranchId,
        lines: [{ productId: ids.productId, qty: 1 }],
      }),
    };
    for (const [name, res] of Object.entries(results))
      expect({ name, status: res.status }).toEqual({ name, status: 403 });
  });
});
