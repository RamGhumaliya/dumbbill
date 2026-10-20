import { uuid7 } from '../../src/common/uuid7';
import { createTestDatabase, TestDatabase } from '../support/test-database';

/**
 * Database-level guarantees behind suppliers, purchases and stock (P1-5), checked as the restricted app role (what the
 * running API uses) and as the owner (for rules that must hold whatever code runs). The HTTP tests prove the features;
 * these prove the walls hold even if application code is wrong: businesses cannot see each other's stock, the ledger and
 * the audit chain can only be added to, and impossible values cannot be stored.
 */
let db: TestDatabase;
const tenantA = uuid7();
const tenantB = uuid7();
const ids = { branchA: '', branchB: '', productA: '', productB: '', supplierA: '', ledgerA: '' };

const TABLES = [
  'suppliers',
  'purchases',
  'purchase_lines',
  'stock_batches',
  'stock_levels',
  'stock_ledger',
  'stock_transfers',
  'stock_transfer_lines',
  'supplier_returns',
  'supplier_return_lines',
  'stock_thresholds',
  'idempotency_keys',
  'document_counters',
  'audit_chain',
];

beforeAll(async () => {
  db = await createTestDatabase();
  for (const [tenantId, label] of [
    [tenantA, 'a'],
    [tenantB, 'b'],
  ] as const) {
    await db.owner.tenant.create({ data: { id: tenantId, name: `Business ${label}` } });
    const branch = await db.owner.branch.create({
      data: { tenantId, name: 'Main', invoicePrefix: label.toUpperCase() },
    });
    const product = await db.owner.product.create({ data: { tenantId, name: 'Whey' } });
    const supplier = await db.owner.supplier.create({ data: { tenantId, name: 'Nutri' } });
    const purchase = await db.owner.purchase.create({
      data: {
        tenantId,
        branchId: branch.id,
        supplierId: supplier.id,
        invoiceRef: 'INV-1',
        invoiceDate: new Date('2026-10-01'),
        subtotalPaise: 1_000,
        totalPaise: 1_000,
        lines: {
          create: {
            tenantId,
            productId: product.id,
            qty: 1,
            unitCostPaise: 1_000,
            allocatedCostPaise: 0,
            lineTotalPaise: 1_000,
          },
        },
      },
    });
    const batch = await db.owner.stockBatch.create({
      data: { tenantId, branchId: branch.id, productId: product.id, qtyRemaining: 1 },
    });
    await db.owner.stockLevel.create({
      data: { tenantId, branchId: branch.id, productId: product.id, qty: 1, valuePaise: 1_000n },
    });
    const ledger = await db.owner.stockLedger.create({
      data: {
        tenantId,
        branchId: branch.id,
        productId: product.id,
        batchId: batch.id,
        type: 'PURCHASE',
        qtyDelta: 1,
        valueDeltaPaise: 1_000n,
        unitCostPaise: 1_000,
        qtyAfter: 1,
        valueAfterPaise: 1_000n,
        wacAfterPaise: 1_000,
        refType: 'PURCHASE',
        refId: purchase.id,
      },
    });
    // A transfer and a debit note per business, so the isolation checks have rows to look at in every table.
    const otherBranch = await db.owner.branch.create({
      data: { tenantId, name: 'Second', invoicePrefix: `${label.toUpperCase()}2` },
    });
    await db.owner.stockTransfer.create({
      data: {
        tenantId,
        fromBranchId: branch.id,
        toBranchId: otherBranch.id,
        lines: { create: { tenantId, productId: product.id, qty: 1, valuePaise: 1_000n } },
      },
    });
    await db.owner.supplierReturn.create({
      data: {
        tenantId,
        branchId: branch.id,
        supplierId: supplier.id,
        debitNoteNo: 'DN-9000',
        reason: 'Seed',
        creditTotalPaise: 10,
        lines: {
          create: {
            tenantId,
            productId: product.id,
            qty: 1,
            unitCreditPaise: 10,
            creditPaise: 10,
            costValuePaise: 0n,
          },
        },
      },
    });
    await db.owner.stockThreshold.create({
      data: { tenantId, branchId: branch.id, productId: product.id, minQty: 2 },
    });
    await db.owner.idempotencyKey.create({
      data: {
        tenantId,
        scope: 'x',
        key: 'k',
        requestHash: 'h',
        responseStatus: 201,
        responseBody: {},
      },
    });
    await db.owner.documentCounter.create({ data: { tenantId, kind: 'DN', nextNo: 2 } });
    await db.owner.auditChain.create({
      data: { tenantId, seq: 1, auditId: uuid7(), prevHash: '', hash: 'h1' },
    });
    if (label === 'a') {
      ids.branchA = branch.id;
      ids.productA = product.id;
      ids.supplierA = supplier.id;
      ids.ledgerA = ledger.id;
    } else {
      ids.branchB = branch.id;
      ids.productB = product.id;
    }
  }
});

afterAll(async () => {
  await db.drop();
});

describe('suppliers, purchases and stock are walled off per business', () => {
  it.each(TABLES)('with business A selected, %s shows nothing of business B', async (table) => {
    const rows = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(`SELECT tenant_id FROM ${table}`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenant_id === tenantA)).toBe(true);
  });

  it('with no business selected they are all empty', async () => {
    for (const table of TABLES) {
      expect(await db.app.$queryRawUnsafe(`SELECT 1 FROM ${table}`)).toEqual([]);
    }
  });

  it('business A cannot change, delete or add stock to business B, even by guessing ids', async () => {
    const changed = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.stockLevel.updateMany({ where: { productId: ids.productB }, data: { qty: 999 } }),
    );
    const deleted = await db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
      tx.supplier.deleteMany({ where: { tenantId: tenantB } }),
    );
    expect(changed.count).toBe(0);
    expect(deleted.count).toBe(0);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.stockLevel.create({
          data: {
            tenantId: tenantB,
            branchId: ids.branchB,
            productId: ids.productB,
            qty: 5,
            valuePaise: 1n,
          },
        }),
      ),
    ).rejects.toThrow();
    expect((await db.owner.stockLevel.findFirstOrThrow({ where: { tenantId: tenantB } })).qty).toBe(
      1,
    );
  });
});

describe('the stock ledger and the audit chain can only be added to', () => {
  it('refuse the app role changing or deleting a ledger row or a seal', async () => {
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.stockLedger.updateMany({ data: { qtyDelta: 5 } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) => tx.stockLedger.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.auditChain.updateMany({ data: { hash: 'x' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) => tx.auditChain.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
  });

  it('also refuse the table OWNER (a script with the owner password), by a trigger', async () => {
    await expect(
      db.owner.stockLedger.update({ where: { id: ids.ledgerA }, data: { qtyDelta: 9 } }),
    ).rejects.toThrow(/append-only/i);
    await expect(db.owner.stockLedger.delete({ where: { id: ids.ledgerA } })).rejects.toThrow(
      /append-only/i,
    );
    await expect(db.owner.auditChain.deleteMany({ where: { tenantId: tenantA } })).rejects.toThrow(
      /append-only/i,
    );
    expect(await db.owner.stockLedger.count({ where: { tenantId: tenantA } })).toBe(1);
  });

  it('still let the app role add rows', async () => {
    await expect(
      db.tenantTx.runAs({ tenantId: tenantA }, (tx) =>
        tx.stockLedger.create({
          data: {
            tenantId: tenantA,
            branchId: ids.branchA,
            productId: ids.productA,
            type: 'ADJUSTMENT_IN',
            qtyDelta: 1,
            valueDeltaPaise: 0n,
            unitCostPaise: 0,
            qtyAfter: 2,
            valueAfterPaise: 1_000n,
            wacAfterPaise: 500,
            refType: 'ADJUSTMENT',
          },
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('values the database refuses whatever code writes them', () => {
  const ledger = (overrides: Record<string, unknown>) => ({
    tenantId: tenantA,
    branchId: ids.branchA,
    productId: ids.productA,
    type: 'ADJUSTMENT_IN' as const,
    qtyDelta: 1,
    valueDeltaPaise: 1n,
    unitCostPaise: 1,
    qtyAfter: 1,
    valueAfterPaise: 1n,
    wacAfterPaise: 1,
    refType: 'ADJUSTMENT',
    ...overrides,
  });

  it('negative stock, negative value, and value with no stock', async () => {
    const update = (data: Record<string, unknown>) =>
      db.owner.stockLevel.update({
        where: { branchId_productId: { branchId: ids.branchA, productId: ids.productA } },
        data,
      });
    await expect(update({ qty: -1 })).rejects.toThrow(/check constraint/i);
    await expect(update({ valuePaise: -1n })).rejects.toThrow(/check constraint/i);
    await expect(update({ qty: 0, valuePaise: 5n })).rejects.toThrow(/check constraint/i);
    await expect(update({ qty: 0, valuePaise: 0n })).resolves.toBeDefined();
    await update({ qty: 2, valuePaise: 2_000n });
  });

  it('a ledger row whose quantity and value move in opposite directions, a zero movement, or a negative balance', async () => {
    await expect(
      db.owner.stockLedger.create({ data: ledger({ qtyDelta: 1, valueDeltaPaise: -5n }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.stockLedger.create({
        data: ledger({ qtyDelta: -1, valueDeltaPaise: 5n, qtyAfter: 0 }),
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.stockLedger.create({ data: ledger({ qtyDelta: 0, valueDeltaPaise: 0n }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(db.owner.stockLedger.create({ data: ledger({ qtyAfter: -1 }) })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('a purchase whose total is not subtotal plus extra costs, or over Rs 2 crore, or with a blank invoice number', async () => {
    const purchase = (overrides: Record<string, unknown>) => ({
      tenantId: tenantA,
      branchId: ids.branchA,
      supplierId: ids.supplierA,
      invoiceRef: `X-${Math.random()}`,
      invoiceDate: new Date('2026-10-01'),
      subtotalPaise: 1_000,
      otherCostPaise: 100,
      totalPaise: 1_100,
      ...overrides,
    });
    await expect(
      db.owner.purchase.create({ data: purchase({ totalPaise: 1_000 }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.purchase.create({
        data: purchase({ subtotalPaise: 2_000_000_000, totalPaise: 2_000_000_100 }),
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.purchase.create({ data: purchase({ invoiceRef: '  ' }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(db.owner.purchase.create({ data: purchase({}) })).resolves.toBeDefined();
  });

  it('the same supplier invoice number twice (but not across suppliers or businesses)', async () => {
    const other = await db.owner.supplier.create({
      data: { tenantId: tenantA, name: 'Other supplier' },
    });
    const bill = (supplierId: string, tenantId = tenantA, branchId = ids.branchA) => ({
      tenantId,
      branchId,
      supplierId,
      invoiceRef: 'INV-1',
      invoiceDate: new Date('2026-10-01'),
      subtotalPaise: 5,
      totalPaise: 5,
    });
    await expect(db.owner.purchase.create({ data: bill(ids.supplierA) })).rejects.toThrow(
      /unique/i,
    );
    await expect(db.owner.purchase.create({ data: bill(other.id) })).resolves.toBeDefined();
  });

  it('a purchase line whose total is not qty x price + share, or with a zero quantity', async () => {
    const purchase = await db.owner.purchase.findFirstOrThrow({ where: { tenantId: tenantA } });
    const line = (overrides: Record<string, unknown>) => ({
      tenantId: tenantA,
      purchaseId: purchase.id,
      productId: ids.productA,
      qty: 2,
      unitCostPaise: 100,
      allocatedCostPaise: 10,
      lineTotalPaise: 210,
      ...overrides,
    });
    await expect(
      db.owner.purchaseLine.create({ data: line({ lineTotalPaise: 200 }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.purchaseLine.create({ data: line({ qty: 0, lineTotalPaise: 10 }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(db.owner.purchaseLine.create({ data: line({}) })).resolves.toBeDefined();
  });

  it('two batches with the same number and expiry at one branch (the shared "no batch" lot included)', async () => {
    const batch = (overrides: Record<string, unknown>) => ({
      tenantId: tenantA,
      branchId: ids.branchA,
      productId: ids.productA,
      qtyRemaining: 1,
      ...overrides,
    });
    // The beforeAll batch is the shared "no batch, no expiry" lot: a second one is refused.
    await expect(db.owner.stockBatch.create({ data: batch({}) })).rejects.toThrow(/unique/i);
    await expect(
      db.owner.stockBatch.create({
        data: batch({ batchNo: 'L1', expiryDate: new Date('2027-01-01') }),
      }),
    ).resolves.toBeDefined();
    await expect(
      db.owner.stockBatch.create({
        data: batch({ batchNo: 'L1', expiryDate: new Date('2027-01-01') }),
      }),
    ).rejects.toThrow(/unique/i);
    await expect(
      db.owner.stockBatch.create({
        data: batch({ batchNo: 'L1', expiryDate: new Date('2027-02-01') }),
      }),
    ).resolves.toBeDefined();
    await expect(
      db.owner.stockBatch.create({ data: batch({ qtyRemaining: -1, batchNo: 'NEG' }) }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('a transfer to the same branch, or whose status disagrees with its timestamps', async () => {
    const transfer = (overrides: Record<string, unknown>) => ({
      tenantId: tenantA,
      fromBranchId: ids.branchA,
      toBranchId: ids.branchB,
      ...overrides,
    });
    await expect(
      db.owner.stockTransfer.create({ data: transfer({ toBranchId: ids.branchA }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.stockTransfer.create({ data: transfer({ status: 'RECEIVED' }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.stockTransfer.create({
        data: transfer({ status: 'CANCELLED', receivedAt: new Date(), cancelledAt: new Date() }),
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(db.owner.stockTransfer.create({ data: transfer({}) })).resolves.toBeDefined();
    await expect(
      db.owner.stockTransfer.create({
        data: transfer({ status: 'RECEIVED', receivedAt: new Date() }),
      }),
    ).resolves.toBeDefined();
  });

  it('a supplier with a blank name, a malformed GSTIN or phone, and a repeated name', async () => {
    const supplier = (overrides: Record<string, unknown>) => ({
      tenantId: tenantA,
      name: `S-${Math.random()}`,
      ...overrides,
    });
    await expect(db.owner.supplier.create({ data: supplier({ name: ' ' }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(db.owner.supplier.create({ data: supplier({ gstin: 'bad' }) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      db.owner.supplier.create({ data: supplier({ phone: 'call me' }) }),
    ).rejects.toThrow(/check constraint/i);
    await expect(db.owner.supplier.create({ data: supplier({ name: 'Nutri' }) })).rejects.toThrow(
      /unique/i,
    );
  });

  it('a debit note whose credit does not equal qty x unit credit, a repeated debit note number, a negative threshold, an out-of-range expiry window', async () => {
    const ret = await db.owner.supplierReturn.create({
      data: {
        tenantId: tenantA,
        branchId: ids.branchA,
        supplierId: ids.supplierA,
        debitNoteNo: 'DN-0001',
        reason: 'Back',
        creditTotalPaise: 10,
      },
    });
    await expect(
      db.owner.supplierReturnLine.create({
        data: {
          tenantId: tenantA,
          returnId: ret.id,
          productId: ids.productA,
          qty: 2,
          unitCreditPaise: 5,
          creditPaise: 11,
          costValuePaise: 0n,
        },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.supplierReturn.create({
        data: {
          tenantId: tenantA,
          branchId: ids.branchA,
          supplierId: ids.supplierA,
          debitNoteNo: 'DN-0001',
          reason: 'Dup',
          creditTotalPaise: 1,
        },
      }),
    ).rejects.toThrow(/unique/i);
    await expect(
      db.owner.stockThreshold.update({
        where: { branchId_productId: { branchId: ids.branchA, productId: ids.productA } },
        data: { minQty: -1 },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.tenant.update({ where: { id: tenantA }, data: { nearExpiryDays: 0 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.owner.tenant.update({ where: { id: tenantA }, data: { nearExpiryDays: 366 } }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('a product or branch that stock refers to cannot be deleted', async () => {
    await expect(db.owner.product.delete({ where: { id: ids.productA } })).rejects.toThrow();
    await expect(db.owner.branch.delete({ where: { id: ids.branchA } })).rejects.toThrow();
  });
});
