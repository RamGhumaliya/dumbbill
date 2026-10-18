import { createTestDatabase, TestDatabase } from '../support/test-database';
import { uuid7 } from '../../src/common/uuid7';

/**
 * Database-level guarantees behind sign-in, checked as the restricted app role (exactly what the running API
 * connects as). The HTTP tests prove the features work; these prove the walls hold even if application code is
 * wrong or an attacker finds an SQL injection: the database itself still refuses.
 */
let db: TestDatabase;
let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  db = await createTestDatabase();
  tenantA = uuid7();
  tenantB = uuid7();
  userA = uuid7();
  userB = uuid7();
  // Two businesses, each with an owner, a session, a refresh token and an audit row (set up as the owner).
  for (const [tenantId, userId, email] of [
    [tenantA, userA, 'owner.a@example.test'],
    [tenantB, userB, 'owner.b@example.test'],
  ] as const) {
    await db.owner.tenant.create({ data: { id: tenantId, name: `Business ${email}` } });
    await db.owner.user.create({
      data: {
        id: userId,
        tenantId,
        email,
        fullName: 'Owner',
        passwordHash: 'v1:$argon2id$placeholder',
        status: 'ACTIVE',
        totpSecretEnc: 'v1.should.never.leak',
        totpRecoveryHashes: ['hash-1'],
      },
    });
    const session = await db.owner.session.create({
      data: { tenantId, userId, clientType: 'MOBILE', deviceLabel: 'Test' },
    });
    await db.owner.refreshToken.create({
      data: {
        tenantId,
        sessionId: session.id,
        tokenHash: `hash-${email}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await db.owner.auditLog.create({ data: { tenantId, action: 'test.event' } });
  }
});

afterAll(async () => {
  await db.drop();
});

describe('the login lookup function (sign-in before the business is known)', () => {
  it('finds one account by exact email, case-insensitively, as the app role without any tenant set', async () => {
    const rows = await db.app.$queryRaw<Array<{ user_id: string; tenant_id: string }>>`
      SELECT * FROM find_login_by_email('Owner.A@Example.TEST')`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: userA, tenant_id: tenantA });
  });

  it('returns nothing for an unknown email', async () => {
    expect(
      await db.app.$queryRaw`SELECT * FROM find_login_by_email('nobody@example.test')`,
    ).toEqual([]);
  });

  it('returns ONLY the columns login needs: no TOTP secret, recovery codes or tokens', async () => {
    const [row] = await db.app.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM find_login_by_email('owner.a@example.test')`;
    expect(Object.keys(row!).sort()).toEqual([
      'email',
      'email_verified_at',
      'full_name',
      'password_hash',
      'status',
      'tenant_id',
      'totp_enabled',
      'user_id',
    ]);
    expect(JSON.stringify(row)).not.toMatch(/should\.never\.leak|hash-1/);
  });

  it('cannot be used to list accounts: a pattern or empty value matches nothing', async () => {
    for (const probe of ['%', '%@example.test', '', 'owner.a@example.test OR 1=1']) {
      expect(await db.app.$queryRaw`SELECT * FROM find_login_by_email(${probe})`).toEqual([]);
    }
  });

  it('is not a hole in the users table: a direct query without a tenant still sees nothing', async () => {
    expect(await db.app.$queryRaw`SELECT id FROM users`).toEqual([]);
  });

  it('belongs to a role that cannot sign in and cannot skip row-level security', async () => {
    const [role] = await db.owner.$queryRaw<
      Array<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>
    >`
      SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'dumbbill_auth'`;
    expect(role).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false });
  });

  it('can read only the listed columns of users (a mistake in the function could not reach secrets)', async () => {
    const columns = await db.owner.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE grantee = 'dumbbill_auth' AND table_name = 'users' AND privilege_type = 'SELECT'`;
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain('totp_secret_enc');
    expect(names).not.toContain('totp_recovery_hashes');
    expect(names).toContain('password_hash');
  });
});

describe('sessions, tokens and the audit log are walled off per business', () => {
  it.each(['sessions', 'refresh_tokens', 'auth_tokens', 'audit_log'])(
    'with business A selected, %s shows nothing of business B',
    async (table) => {
      const rows = await db.tenantTx.runAs({ tenantId: tenantA, userId: userA }, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(`SELECT tenant_id FROM ${table}`),
      );
      expect(rows.every((row) => row.tenant_id === tenantA)).toBe(true);
    },
  );

  it('with no business selected the sign-in tables are empty', async () => {
    for (const table of ['sessions', 'refresh_tokens', 'auth_tokens', 'audit_log']) {
      expect(await db.app.$queryRawUnsafe(`SELECT 1 FROM ${table}`)).toEqual([]);
    }
  });

  it("business A cannot revoke or read business B's session even by guessing its id", async () => {
    const bSession = await db.owner.session.findFirstOrThrow({ where: { tenantId: tenantB } });
    const changed = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.session.updateMany({ where: { id: bSession.id }, data: { revokedAt: new Date() } }),
    );
    expect(changed.count).toBe(0);
    expect(
      (await db.owner.session.findUniqueOrThrow({ where: { id: bSession.id } })).revokedAt,
    ).toBeNull();
  });
});

describe('the audit log is append-only for the app role', () => {
  it('can add rows for its own business', async () => {
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.auditLog.create({ data: { tenantId: tenantA, action: 'test.added' } }),
      ),
    ).resolves.toBeDefined();
  });

  it('cannot add a row for another business', async () => {
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.auditLog.create({ data: { tenantId: tenantB, action: 'test.forged' } }),
      ),
    ).rejects.toThrow();
  });

  it('cannot change or delete rows (permission denied, before the trigger is even reached)', async () => {
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.auditLog.updateMany({ data: { action: 'tampered' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) => tx.auditLog.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
  });

  it('stays protected after later migrations: app_grant_defaults() removes UPDATE/DELETE again', async () => {
    // Every migration calls app_grant_defaults(), which grants UPDATE and DELETE on all tables. If it did not
    // also re-apply the append-only rule, a future migration would quietly make the audit log editable.
    await db.owner.$executeRawUnsafe('SELECT app_grant_defaults()');
    const rights = await db.owner.$queryRaw<Array<{ privilege_type: string }>>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'dumbbill_app' AND table_name = 'audit_log'`;
    const names = rights.map((r) => r.privilege_type).sort();
    expect(names).toEqual(['INSERT', 'SELECT']);
  });
});
