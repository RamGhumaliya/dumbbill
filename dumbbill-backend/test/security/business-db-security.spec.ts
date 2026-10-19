import { uuid7 } from '../../src/common/uuid7';
import { createTestDatabase, TestDatabase } from '../support/test-database';

/**
 * Database-level guarantees behind the business profile and branches (P1-3): bad GSTIN shapes, impossible invoice
 * prefixes or receipt widths, and made-up states are refused whatever code writes them, and one business's prefixes
 * never collide with another's. The HTTP tests prove the friendly messages; these prove the walls hold even if
 * application code is wrong.
 */
let db: TestDatabase;
const tenantA = uuid7();
const tenantB = uuid7();

beforeAll(async () => {
  db = await createTestDatabase();
  await db.owner.gstState.createMany({
    data: [
      { code: '27', name: 'Maharashtra' },
      { code: '29', name: 'Karnataka' },
    ],
  });
  await db.owner.tenant.create({ data: { id: tenantA, name: 'Business A' } });
  await db.owner.tenant.create({ data: { id: tenantB, name: 'Business B' } });
});

afterAll(async () => {
  await db.drop();
});

const branch = (overrides: Record<string, unknown> = {}) => ({
  tenantId: tenantA,
  name: `Branch ${Math.random()}`,
  invoicePrefix: `P${Math.floor(Math.random() * 1e5)}`,
  ...overrides,
});

describe('branch values the database refuses', () => {
  it('an invoice prefix with lower case, symbols, spaces, nothing or more than six characters', async () => {
    for (const invoicePrefix of ['kot', 'K-1', 'K 1', '', 'TOOLONG1']) {
      await expect(db.owner.branch.create({ data: branch({ invoicePrefix }) })).rejects.toThrow();
    }
    await expect(
      db.owner.branch.create({ data: branch({ invoicePrefix: 'K1' }) }),
    ).resolves.toBeDefined();
  });

  it('a receipt width other than 58 or 80 mm', async () => {
    await expect(db.owner.branch.create({ data: branch({ printerWidthMm: 70 }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      db.owner.branch.create({ data: branch({ printerWidthMm: 58 }) }),
    ).resolves.toBeDefined();
  });

  it('a state code that is not a GST state', async () => {
    await expect(db.owner.branch.create({ data: branch({ stateCode: '55' }) })).rejects.toThrow(
      /foreign key/i,
    );
  });

  it('a GSTIN of the wrong shape, or one that does not start with the branch state', async () => {
    await expect(
      db.owner.branch.create({ data: branch({ stateCode: '27', gstin: 'NOT-A-GSTIN' }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.branch.create({ data: branch({ stateCode: '29', gstin: '27AAPFU0939F1ZV' }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.branch.create({ data: branch({ stateCode: '27', gstin: '27AAPFU0939F1ZV' }) }),
    ).resolves.toBeDefined();
  });

  it('a PIN code or phone number of the wrong shape', async () => {
    await expect(db.owner.branch.create({ data: branch({ pincode: '01234' }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(db.owner.branch.create({ data: branch({ phone: 'call me' }) })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('the same invoice prefix twice in one business, but not across two businesses', async () => {
    await db.owner.branch.create({ data: branch({ invoicePrefix: 'SAME' }) });
    await expect(
      db.owner.branch.create({ data: branch({ invoicePrefix: 'SAME' }) }),
    ).rejects.toThrow(/unique/i);
    await expect(
      db.owner.branch.create({ data: branch({ tenantId: tenantB, invoicePrefix: 'SAME' }) }),
    ).resolves.toBeDefined();
  });
});

describe('business profile values the database refuses', () => {
  it('a GSTIN of the wrong shape, or one that does not start with the business state', async () => {
    await expect(
      db.owner.tenant.update({ where: { id: tenantA }, data: { gstin: 'abc' } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.tenant.update({
        where: { id: tenantA },
        data: { stateCode: '29', gstin: '27AAPFU0939F1ZV' },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.tenant.update({
        where: { id: tenantA },
        data: { stateCode: '27', gstin: '27AAPFU0939F1ZV' },
      }),
    ).resolves.toBeDefined();
  });

  it('a state code that is not a GST state', async () => {
    await expect(
      db.owner.tenant.update({ where: { id: tenantB }, data: { stateCode: '55' } }),
    ).rejects.toThrow(/foreign key/i);
  });
});
