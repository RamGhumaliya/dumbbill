import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import {
  buy,
  makeShop,
  newProduct,
  newSupplier,
  postWithKey,
  seedGrowthPlan,
} from '../support/inventory-helpers';
import { as } from '../support/team-helpers';

/**
 * The audit log viewer and the tamper-evident chain (US-AUD-01, security.md section 6), end to end against a real
 * database. The tamper tests switch off the database's own protections (as a person with the owner password could) to prove
 * the chain notices what the protections would otherwise prevent.
 */
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp();
  await seedGrowthPlan(t);
});

afterAll(async () => {
  await t.close();
});

/** Run SQL as the table owner with the audit log's protection switched off, then switched on again. */
async function withoutProtection(work: () => Promise<void>): Promise<void> {
  await t.db.owner.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only');
  try {
    await work();
  } finally {
    await t.db.owner.$executeRawUnsafe(
      'ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only',
    );
  }
}

describe('the audit log viewer', () => {
  it('shows who did what with their role, device and the state before and after, newest first', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 10, unitCostPaise: 1_000 }],
    });
    await postWithKey(t, shop.admin, '/v1/stock/adjustments', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 8,
      reason: 'DAMAGE',
    });

    const res = await as(t, shop.owner).get('/v1/audit?action=stock.');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      action: 'stock.adjusted',
      entity: 'product',
      entityId: product,
      actorName: 'admin person',
      actorRole: 'Admin',
      before: { qty: 10 },
      after: { qty: 8 },
      metadata: { reason: 'DAMAGE' },
    });
    expect(res.body.items[0].requestId).toEqual(expect.any(String));
    const everything = (await as(t, shop.owner).get('/v1/audit?limit=100')).body.items;
    const times = everything.map((e: { createdAt: string }) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('filters by event prefix, what it was done to, who did it, and a time range, and pages', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    await newSupplier(t, shop.admin);
    const byAdmin = (
      await as(t, shop.owner).get(`/v1/audit?actorUserId=${shop.admin.userId}&limit=100`)
    ).body;
    expect(
      byAdmin.items.every((e: { actorUserId: string }) => e.actorUserId === shop.admin.userId),
    ).toBe(true);
    expect(byAdmin.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['product.created', 'supplier.created']),
    );

    expect(
      (await as(t, shop.owner).get('/v1/audit?entity=supplier')).body.items.every(
        (e: { entity: string }) => e.entity === 'supplier',
      ),
    ).toBe(true);
    expect(
      (await as(t, shop.owner).get(`/v1/audit?action=product.created`)).body.items.map(
        (e: { entityId: string }) => e.entityId,
      ),
    ).toContain(product);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await as(t, shop.owner).get(`/v1/audit?from=${future}`)).body.total).toBe(0);
    expect((await as(t, shop.owner).get(`/v1/audit?to=${future}`)).body.total).toBeGreaterThan(0);

    const total = (await as(t, shop.owner).get('/v1/audit')).body.total;
    const page = (await as(t, shop.owner).get('/v1/audit?limit=2&offset=1')).body;
    expect(page).toMatchObject({ total, limit: 2, offset: 1 });
    expect(page.items).toHaveLength(2);
    expect((await as(t, shop.owner).get('/v1/audit?limit=500')).status).toBe(400);
    expect((await as(t, shop.owner).get('/v1/audit?from=yesterday')).status).toBe(400);
  });

  it('needs audit.read, and each business sees only its own log', async () => {
    const mine = await makeShop(t);
    const theirs = await makeShop(t);
    await newSupplier(t, theirs.admin, { name: 'Secret Supplier Ltd' });
    expect((await as(t, mine.cashier).get('/v1/audit')).status).toBe(403);
    expect((await as(t, mine.cashier).get('/v1/audit/verify')).status).toBe(403);
    const mineLog = JSON.stringify((await as(t, mine.owner).get('/v1/audit?limit=100')).body);
    expect(mineLog).not.toContain('Secret Supplier Ltd');
    expect(mineLog).not.toContain(theirs.owner.tenantId);
  });
});

describe('the tamper-evident chain', () => {
  it('seals entries in order as the log is viewed, and a fresh log verifies', async () => {
    const shop = await makeShop(t);
    await newSupplier(t, shop.admin);
    const before = (await as(t, shop.owner).get('/v1/audit/verify')).body;
    expect(before).toMatchObject({ ok: true, unsealed: 0, firstBrokenSeq: null, problem: null });
    expect(before.sealed).toBeGreaterThan(0);

    // New activity is unsealed until the log is next viewed, and verifying seals it first.
    await newSupplier(t, shop.admin);
    const unsealed = await t.db.owner.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT count(*) AS n FROM audit_log a WHERE a.tenant_id = ${shop.owner.tenantId}::uuid AND NOT EXISTS (SELECT 1 FROM audit_chain c WHERE c.audit_id = a.id)`;
    expect(Number(unsealed[0]!.n)).toBeGreaterThan(0);
    const after = (await as(t, shop.owner).get('/v1/audit/verify')).body;
    expect(after).toMatchObject({ ok: true, unsealed: 0 });
    expect(after.sealed).toBeGreaterThan(before.sealed);

    const seqs = (
      await t.db.owner.auditChain.findMany({
        where: { tenantId: shop.owner.tenantId },
        orderBy: { seq: 'asc' },
      })
    ).map((c) => c.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('several people viewing the log at the same moment seal each entry once and keep the chain intact', async () => {
    const shop = await makeShop(t);
    for (let i = 0; i < 4; i += 1) await newSupplier(t, shop.admin);
    const answers = await Promise.all(
      [1, 2, 3, 4, 5].map(() => as(t, shop.owner).get('/v1/audit?limit=10')),
    );
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200, 200]);
    const verify = (await as(t, shop.owner).get('/v1/audit/verify')).body;
    expect(verify).toMatchObject({ ok: true, unsealed: 0 });
    const chain = await t.db.owner.auditChain.findMany({
      where: { tenantId: shop.owner.tenantId },
      orderBy: { seq: 'asc' },
    });
    expect(new Set(chain.map((c) => c.auditId)).size).toBe(chain.length);
  });

  it('notices an entry that was changed, and points at the first seal that fails', async () => {
    const shop = await makeShop(t);
    for (let i = 0; i < 3; i += 1) await newSupplier(t, shop.admin);
    expect((await as(t, shop.owner).get('/v1/audit/verify')).body.ok).toBe(true);

    const chain = await t.db.owner.auditChain.findMany({
      where: { tenantId: shop.owner.tenantId },
      orderBy: { seq: 'asc' },
    });
    const target = chain[Math.floor(chain.length / 2)]!;
    const original = await t.db.owner.auditLog.findUniqueOrThrow({ where: { id: target.auditId } });
    await withoutProtection(async () => {
      await t.db.owner.auditLog.update({
        where: { id: target.auditId },
        data: { action: 'nothing.to.see.here' },
      });
    });
    const tampered = (await as(t, shop.owner).get('/v1/audit/verify')).body;
    expect(tampered).toMatchObject({
      ok: false,
      firstBrokenSeq: target.seq,
      problem: 'A sealed audit entry has been changed.',
    });

    // Putting it back makes the chain valid again: the seals depend only on the content.
    await withoutProtection(async () => {
      await t.db.owner.auditLog.update({
        where: { id: target.auditId },
        data: { action: original.action },
      });
    });
    expect((await as(t, shop.owner).get('/v1/audit/verify')).body.ok).toBe(true);
  });

  it('notices changes to the details a reader cares about: who, what, when, from where, before and after', async () => {
    const shop = await makeShop(t);
    const product = await newProduct(t, shop.admin);
    const supplier = await newSupplier(t, shop.admin);
    await buy(t, shop.admin, {
      supplierId: supplier,
      branchId: shop.mainBranchId,
      lines: [{ productId: product, qty: 10, unitCostPaise: 1_000 }],
    });
    await postWithKey(t, shop.admin, '/v1/stock/adjustments', {
      branchId: shop.mainBranchId,
      productId: product,
      countedQty: 8,
      reason: 'LOST',
    });
    await as(t, shop.owner).get('/v1/audit/verify');
    const adjusted = await t.db.owner.auditLog.findFirstOrThrow({
      where: { tenantId: shop.owner.tenantId, action: 'stock.adjusted' },
    });
    const changes: Array<[string, Record<string, unknown>]> = [
      ['who', { actorUserId: shop.owner.userId }],
      ['when', { createdAt: new Date(adjusted.createdAt.getTime() + 1000) }],
      ['where from', { ipAddress: '6.6.6.6' }],
      ['the after state', { after: { qty: 80 } }],
      ['the before state', { before: { qty: 1 } }],
      ['the role', { actorRole: 'Owner' }],
    ];
    for (const [label, data] of changes) {
      let original: Record<string, unknown> = {};
      await withoutProtection(async () => {
        original = Object.fromEntries(
          Object.keys(data).map((key) => [
            key,
            (adjusted as unknown as Record<string, unknown>)[key],
          ]),
        );
        await t.db.owner.auditLog.update({ where: { id: adjusted.id }, data: data as never });
      });
      const verdict = (await as(t, shop.owner).get('/v1/audit/verify')).body;
      expect([label, verdict.ok]).toEqual([label, false]);
      await withoutProtection(async () => {
        await t.db.owner.auditLog.update({ where: { id: adjusted.id }, data: original as never });
      });
    }
    expect((await as(t, shop.owner).get('/v1/audit/verify')).body.ok).toBe(true);
  });

  it('notices an entry that was removed', async () => {
    const shop = await makeShop(t);
    for (let i = 0; i < 3; i += 1) await newSupplier(t, shop.admin);
    await as(t, shop.owner).get('/v1/audit/verify');
    const chain = await t.db.owner.auditChain.findMany({
      where: { tenantId: shop.owner.tenantId },
      orderBy: { seq: 'asc' },
    });
    const target = chain[2]!;
    // The chain row references the audit row only by id (no foreign key), so removing the audit row leaves a dangling seal.
    await withoutProtection(async () => {
      await t.db.owner.auditLog.delete({ where: { id: target.auditId } });
    });
    const verdict = (await as(t, shop.owner).get('/v1/audit/verify')).body;
    expect(verdict).toMatchObject({
      ok: false,
      firstBrokenSeq: target.seq,
      problem: 'A sealed audit entry has been removed.',
    });
  });

  it('notices a seal that was removed from the middle of the chain', async () => {
    const shop = await makeShop(t);
    for (let i = 0; i < 3; i += 1) await newSupplier(t, shop.admin);
    await as(t, shop.owner).get('/v1/audit/verify');
    const chain = await t.db.owner.auditChain.findMany({
      where: { tenantId: shop.owner.tenantId },
      orderBy: { seq: 'asc' },
    });
    const target = chain[1]!;
    await t.db.owner.$executeRawUnsafe(
      'ALTER TABLE audit_chain DISABLE TRIGGER audit_chain_append_only',
    );
    try {
      await t.db.owner.auditChain.delete({
        where: { tenantId_seq: { tenantId: shop.owner.tenantId, seq: target.seq } },
      });
    } finally {
      await t.db.owner.$executeRawUnsafe(
        'ALTER TABLE audit_chain ENABLE TRIGGER audit_chain_append_only',
      );
    }
    const verdict =
      (await t.db.owner.$queryRaw`SELECT 1`,
      (await as(t, shop.owner).get('/v1/audit/verify')).body);
    expect(verdict.ok).toBe(false);
    expect(verdict.firstBrokenSeq).toBe(chain[2]!.seq);
    expect(verdict.problem).toBe('A seal is missing from the chain.');
  });

  it('the chain itself cannot be edited or deleted, even by the table owner', async () => {
    const shop = await makeShop(t);
    await newSupplier(t, shop.admin);
    await as(t, shop.owner).get('/v1/audit/verify');
    await expect(
      t.db.owner.auditChain.updateMany({
        where: { tenantId: shop.owner.tenantId },
        data: { hash: 'x' },
      }),
    ).rejects.toThrow(/append-only/i);
    await expect(
      t.db.owner.auditChain.deleteMany({ where: { tenantId: shop.owner.tenantId } }),
    ).rejects.toThrow(/append-only/i);
  });
});
