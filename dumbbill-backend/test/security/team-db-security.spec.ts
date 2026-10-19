import { uuid7 } from '../../src/common/uuid7';
import { createTestDatabase, TestDatabase } from '../support/test-database';

/**
 * Database-level guarantees behind roles, branches and team assignments, checked as the restricted app role (what the
 * running API uses) and as the owner (for the rules that must hold whatever code runs). The HTTP tests prove the
 * features; these prove the walls hold even if application code is wrong.
 */
let db: TestDatabase;
const tenantA = uuid7();
const tenantB = uuid7();
const userA = uuid7();
const userB = uuid7();

beforeAll(async () => {
  db = await createTestDatabase();
  for (const [tenantId, userId, label] of [
    [tenantA, userA, 'a'],
    [tenantB, userB, 'b'],
  ] as const) {
    await db.owner.tenant.create({ data: { id: tenantId, name: `Business ${label}` } });
    const role = await db.owner.role.create({
      data: { tenantId, name: 'Cashier', systemKey: 'CASHIER', permissions: ['pos.sell'] },
    });
    const branch = await db.owner.branch.create({
      data: { tenantId, name: 'Main branch', invoicePrefix: 'MAIN' },
    });
    await db.owner.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${label}@x.test`,
        fullName: label,
        status: 'ACTIVE',
        roleId: role.id,
      },
    });
    await db.owner.userBranch.create({ data: { tenantId, userId, branchId: branch.id } });
  }
});

afterAll(async () => {
  await db.drop();
});

describe('roles, branches and assignments are walled off per business', () => {
  it.each(['roles', 'branches', 'user_branches'])(
    'with business A selected, %s shows nothing of business B',
    async (table) => {
      const rows = await db.tenantTx.runAs({ tenantId: tenantA, userId: userA }, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(`SELECT tenant_id FROM ${table}`),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.tenant_id === tenantA)).toBe(true);
    },
  );

  it('with no business selected they are empty', async () => {
    for (const table of ['roles', 'branches', 'user_branches']) {
      expect(await db.app.$queryRawUnsafe(`SELECT 1 FROM ${table}`)).toEqual([]);
    }
  });

  it("business A cannot change, delete or insert into business B's roles, even by guessing ids", async () => {
    const bRole = await db.owner.role.findFirstOrThrow({ where: { tenantId: tenantB } });
    const changed = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.role.updateMany({ where: { id: bRole.id }, data: { permissions: [] } }),
    );
    const deleted = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.role.deleteMany({ where: { id: bRole.id } }),
    );
    expect(changed.count).toBe(0);
    expect(deleted.count).toBe(0);
    expect(
      (await db.owner.role.findUniqueOrThrow({ where: { id: bRole.id } })).permissions,
    ).toEqual(['pos.sell']);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.role.create({ data: { tenantId: tenantB, name: 'Forged' } }),
      ),
    ).rejects.toThrow();
  });
});

describe('values the database refuses whatever code writes them', () => {
  const role = (overrides: Record<string, unknown>) => ({
    tenantId: tenantA,
    name: `Role ${Math.random()}`,
    ...overrides,
  });

  it('a discount limit outside 0 to 10000 basis points (0% to 100%)', async () => {
    await expect(db.owner.role.create({ data: role({ discountLimitBp: 10_001 }) })).rejects.toThrow(
      /roles_discount_limit_bp_range|check constraint/i,
    );
    await expect(db.owner.role.create({ data: role({ discountLimitBp: -1 }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      db.owner.role.create({ data: role({ discountLimitBp: 10_000 }) }),
    ).resolves.toBeDefined();
    await expect(
      db.owner.user.update({ where: { id: userA }, data: { discountLimitBp: 20_000 } }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('a blank role name, and an unknown built-in role key', async () => {
    await expect(db.owner.role.create({ data: role({ name: '   ' }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(db.owner.role.create({ data: role({ systemKey: 'SUPERUSER' }) })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('a second built-in role of the same kind in one business, or two roles with the same name', async () => {
    await expect(db.owner.role.create({ data: role({ systemKey: 'CASHIER' }) })).rejects.toThrow(
      /unique/i,
    );
    await expect(db.owner.role.create({ data: role({ name: 'Cashier' }) })).rejects.toThrow(
      /unique/i,
    );
    // ...but another business may have its own Cashier.
    const other = await db.owner.role.findFirst({
      where: { tenantId: tenantB, systemKey: 'CASHIER' },
    });
    expect(other).not.toBeNull();
  });

  it('deleting a role that people still hold', async () => {
    const roleInUse = await db.owner.role.findFirstOrThrow({
      where: { tenantId: tenantA, systemKey: 'CASHIER' },
    });
    await expect(db.owner.role.delete({ where: { id: roleInUse.id } })).rejects.toThrow(
      /foreign key|violates/i,
    );
  });

  it('the same branch assigned to the same person twice', async () => {
    const assignment = await db.owner.userBranch.findFirstOrThrow({ where: { userId: userA } });
    await expect(
      db.owner.userBranch.create({
        data: { tenantId: tenantA, userId: userA, branchId: assignment.branchId },
      }),
    ).rejects.toThrow(/unique/i);
  });
});

describe('the new user columns never reach the login lookup', () => {
  it('find_login_by_email still returns only its eight login columns (no PIN hash, no permissions)', async () => {
    await db.owner.user.update({
      where: { id: userA },
      data: { pinHash: 'v1:$argon2id$secret-pin', extraPermissions: ['team.manage'] },
    });
    const [row] = await db.app.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT * FROM find_login_by_email('a@x.test')`;
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
    expect(JSON.stringify(row)).not.toMatch(/secret-pin|team\.manage/);
  });
});
