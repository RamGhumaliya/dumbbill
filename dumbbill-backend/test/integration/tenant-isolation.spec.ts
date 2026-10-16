import { randomUUID } from 'node:crypto';
import { runWithTenantContext } from '../../src/modules/tenancy/tenant-context';
import { createTestDatabase, TestDatabase } from '../support/test-database';

/**
 * The core promise of the product: one business can never see or change another business's data.
 *
 * Everything here talks to a real PostgreSQL as the restricted app role, the same way the running
 * API does. The key tests run UNFILTERED queries (no "where tenant_id = ..."), because the point is
 * that even when application code forgets the filter, the database still protects the data.
 */
describe('tenant isolation (row-level security)', () => {
  let db: TestDatabase;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA1 = randomUUID();
  const userB1 = randomUUID();

  /** How many users a connection with NO tenant set can see. Must always be 0. */
  async function usersVisibleWithoutTenant(): Promise<bigint> {
    const rows = await db.app.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM users`;
    return rows[0]?.count ?? -1n;
  }

  /** Create a business and two staff members inside that business's own context. */
  async function createTenant(id: string, name: string, firstUserId: string): Promise<void> {
    await db.tenantTx.runAs({ tenantId: id }, async (tx) => {
      // The tenant row is inserted under its own id: the policy's WITH CHECK allows exactly that.
      await tx.tenant.create({ data: { id, name } });
      await tx.user.create({
        data: {
          id: firstUserId,
          tenantId: id,
          email: `owner@${name}.test`,
          fullName: `${name} Owner`,
        },
      });
      await tx.user.create({
        data: { tenantId: id, email: `cashier@${name}.test`, fullName: `${name} Cashier` },
      });
    });
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    await createTenant(tenantA, 'alpha', userA1);
    await createTenant(tenantB, 'beta', userB1);
  });
  afterAll(async () => db.drop());

  describe('the app role itself', () => {
    it('is not a superuser and cannot bypass row-level security', async () => {
      const rows = await db.app.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });

    it('cannot change the database structure', async () => {
      await expect(db.app.$executeRawUnsafe(`CREATE TABLE hack (id int)`)).rejects.toThrow(
        /permission denied/i,
      );
    });

    it("cannot read Prisma's migration bookkeeping table", async () => {
      await expect(db.app.$queryRawUnsafe(`SELECT * FROM _prisma_migrations`)).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  describe('reading', () => {
    it('an UNFILTERED query inside tenant A returns only tenant A users', async () => {
      const emails = await db.tenantTx.runAs(
        { tenantId: tenantA },
        (tx) => tx.$queryRaw<Array<{ email: string }>>`SELECT email FROM users ORDER BY email`,
      );
      expect(emails.map((r) => r.email)).toEqual(['cashier@alpha.test', 'owner@alpha.test']);
    });

    it('an UNFILTERED query inside tenant B returns only tenant B users', async () => {
      const users = await db.tenantTx.runAs({ tenantId: tenantB }, (tx) => tx.user.findMany());
      expect(users.map((u) => u.email).sort()).toEqual(['cashier@beta.test', 'owner@beta.test']);
    });

    it('looking up another business user by its exact id finds nothing', async () => {
      const found = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.user.findUnique({ where: { id: userB1 } }),
      );
      expect(found).toBeNull();
    });

    it('a business can see only its own row in the tenants table', async () => {
      const tenants = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) => tx.tenant.findMany());
      expect(tenants.map((t) => t.id)).toEqual([tenantA]);
    });

    it('with NO tenant set, a query sees nothing at all (fails closed)', async () => {
      expect(await usersVisibleWithoutTenant()).toBe(0n);
    });
  });

  describe('writing', () => {
    it("updating another business's user changes zero rows", async () => {
      const result = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.user.updateMany({ where: { id: userB1 }, data: { fullName: 'HACKED' } }),
      );
      expect(result.count).toBe(0);
      const stillSafe = await db.tenantTx.runAs({ tenantId: tenantB }, (tx) =>
        tx.user.findUniqueOrThrow({ where: { id: userB1 } }),
      );
      expect(stillSafe.fullName).toBe('beta Owner');
    });

    it("deleting another business's user removes zero rows", async () => {
      const result = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.user.deleteMany({ where: { id: userB1 } }),
      );
      expect(result.count).toBe(0);
    });

    it('cannot insert a row that belongs to another business', async () => {
      await expect(
        db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
          tx.user.create({
            data: { tenantId: tenantB, email: 'planted@beta.test', fullName: 'Planted' },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot move an existing row into another business', async () => {
      await expect(
        db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
          tx.user.update({ where: { id: userA1 }, data: { tenantId: tenantB } }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('with NO tenant set, inserting is refused', async () => {
      await expect(
        db.app.user.create({
          data: { tenantId: tenantA, email: 'ghost@alpha.test', fullName: 'Ghost' },
        }),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('the tenant setting never leaks between requests', () => {
    it('is cleared after every transaction, even when connections are reused', async () => {
      // Alternate businesses many times so pooled connections are reused, and after EACH
      // transaction check that a plain query on the shared pool still sees nothing.
      for (let i = 0; i < 20; i += 1) {
        await db.tenantTx.runAs({ tenantId: i % 2 === 0 ? tenantA : tenantB }, (tx) =>
          tx.user.count(),
        );
        expect(await usersVisibleWithoutTenant()).toBe(0n);
      }
    });

    it('keeps simultaneous requests for different businesses apart', async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => {
          const isA = i % 2 === 0;
          return db.tenantTx
            .runAs({ tenantId: isA ? tenantA : tenantB }, (tx) => tx.user.findMany())
            .then((users) => ({ isA, domains: new Set(users.map((u) => u.email.split('@')[1])) }));
        }),
      );
      for (const { isA, domains } of results) {
        expect([...domains]).toEqual([isA ? 'alpha.test' : 'beta.test']);
      }
    });

    it('rolls back everything if the work throws', async () => {
      await expect(
        db.tenantTx.runAs({ tenantId: tenantA }, async (tx) => {
          await tx.user.create({
            data: { tenantId: tenantA, email: 'temp@alpha.test', fullName: 'Temp' },
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const found = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.user.findUnique({ where: { email: 'temp@alpha.test' } }),
      );
      expect(found).toBeNull();
    });
  });

  describe('TenantTx usage rules', () => {
    it('run() refuses to work outside a tenant context', () => {
      expect(() => db.tenantTx.run((tx) => tx.user.findMany())).toThrow(/outside a tenant context/);
    });

    it('run() uses the tenant from the current request context', async () => {
      const users = await runWithTenantContext({ tenantId: tenantB }, () =>
        db.tenantTx.run((tx) => tx.user.findMany()),
      );
      expect(users.every((u) => u.tenantId === tenantB)).toBe(true);
    });

    it('rejects a tenant id that is not a UUID (blocks injection through the setting)', () => {
      expect(() =>
        db.tenantTx.runAs({ tenantId: "x'; DROP TABLE users; --" }, (tx) => tx.user.findMany()),
      ).toThrow(/must be a UUID/);
    });
  });

  it('keeps the global reference tables readable without a tenant', async () => {
    const plans = await db.app.plan.count();
    expect(plans).toBeGreaterThanOrEqual(0); // the table exists and is readable; contents come from the seed
  });
});
