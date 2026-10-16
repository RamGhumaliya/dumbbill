import { createTestDatabase, TestDatabase } from '../support/test-database';
import { findRlsViolations } from '../support/rls-audit';

/**
 * Security suite: every table in the migrated database must be protected by row-level security
 * (or be deliberately listed as global). This test is the guard that fails the build when someone
 * adds a tenant table and forgets its protection.
 *
 * The second half proves the guard itself works: we deliberately break the database in the ways a
 * developer could, and check the audit notices each one.
 */
describe('row-level security coverage', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => db.drop());

  it('reports no problems on the real migrated schema', async () => {
    expect(await findRlsViolations(db.owner)).toEqual([]);
  });

  describe('the audit catches mistakes (each case breaks the database, then repairs it)', () => {
    it('catches a removed policy', async () => {
      await db.owner.$executeRawUnsafe(`DROP POLICY tenant_isolation ON users`);
      try {
        const problems = await findRlsViolations(db.owner);
        expect(problems.join('\n')).toMatch(/users: the "tenant_isolation" policy is missing/);
      } finally {
        await db.owner.$executeRawUnsafe(`SELECT enable_tenant_rls('users')`);
      }
      expect(await findRlsViolations(db.owner)).toEqual([]);
    });

    it('catches RLS that is enabled but not forced', async () => {
      await db.owner.$executeRawUnsafe(`ALTER TABLE users NO FORCE ROW LEVEL SECURITY`);
      try {
        expect((await findRlsViolations(db.owner)).join('\n')).toMatch(
          /users: row-level security is not FORCED/,
        );
      } finally {
        await db.owner.$executeRawUnsafe(`SELECT enable_tenant_rls('users')`);
      }
    });

    it('catches RLS switched off completely', async () => {
      await db.owner.$executeRawUnsafe(`ALTER TABLE tenants DISABLE ROW LEVEL SECURITY`);
      try {
        expect((await findRlsViolations(db.owner)).join('\n')).toMatch(
          /tenants: row-level security is not enabled/,
        );
      } finally {
        await db.owner.$executeRawUnsafe(`SELECT enable_tenant_rls('tenants', 'id')`);
      }
    });

    it('catches a policy that can read but not restrict writes (no WITH CHECK)', async () => {
      await db.owner.$executeRawUnsafe(`DROP POLICY tenant_isolation ON users`);
      await db.owner.$executeRawUnsafe(
        `CREATE POLICY tenant_isolation ON users USING (tenant_id = (SELECT app_current_tenant_id()))`,
      );
      try {
        expect((await findRlsViolations(db.owner)).join('\n')).toMatch(
          /users: policy has no WITH CHECK/,
        );
      } finally {
        await db.owner.$executeRawUnsafe(`SELECT enable_tenant_rls('users')`);
      }
    });

    it('catches a new tenant table that was created without any protection', async () => {
      await db.owner.$executeRawUnsafe(
        `CREATE TABLE leaky_orders (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`,
      );
      try {
        const text = (await findRlsViolations(db.owner)).join('\n');
        expect(text).toMatch(/leaky_orders: row-level security is not enabled/);
        expect(text).toMatch(/leaky_orders: the "tenant_isolation" policy is missing/);
      } finally {
        await db.owner.$executeRawUnsafe(`DROP TABLE leaky_orders`);
      }
    });

    it('catches a new table with no tenant column that is not declared global', async () => {
      await db.owner.$executeRawUnsafe(`CREATE TABLE mystery (id int)`);
      try {
        expect((await findRlsViolations(db.owner)).join('\n')).toMatch(
          /mystery: has no "tenant_id" column/,
        );
      } finally {
        await db.owner.$executeRawUnsafe(`DROP TABLE mystery`);
      }
    });

    it('catches a protected table the app role was never granted access to', async () => {
      await db.owner.$executeRawUnsafe(
        `CREATE TABLE ungranted (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`,
      );
      await db.owner.$executeRawUnsafe(`SELECT enable_tenant_rls('ungranted')`);
      // Deliberately skip app_grant_defaults(). (Dev default privileges would grant it, so revoke explicitly.)
      await db.owner.$executeRawUnsafe(`REVOKE ALL ON ungranted FROM dumbbill_app`);
      try {
        expect((await findRlsViolations(db.owner)).join('\n')).toMatch(
          /ungranted: the app role has no read\/write access/,
        );
      } finally {
        await db.owner.$executeRawUnsafe(`DROP TABLE ungranted`);
      }
    });

    it('ends clean after all the repairs', async () => {
      expect(await findRlsViolations(db.owner)).toEqual([]);
    });
  });
});
