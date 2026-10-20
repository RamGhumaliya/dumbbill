// MUST come before NestJS: the validation decorators rely on it.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { uuid7 } from '../common/uuid7';
import { BranchesService } from '../modules/business/branches.service';
import { BusinessService } from '../modules/business/business.service';
import { ProductsService } from '../modules/catalogue/products.service';
import { PasswordHasher } from '../modules/auth/password/password-hasher.service';
import { StockService } from '../modules/inventory/stock.service';
import { AccessService, LoadedAccess } from '../modules/permissions/access.service';
import {
  createDefaultCategories,
  createDefaultRolesAndBranch,
} from '../modules/permissions/default-roles';
import { PurchasesService } from '../modules/purchasing/purchases.service';
import { SuppliersService } from '../modules/purchasing/suppliers.service';
import { LoginLookup } from '../modules/tenancy/login-lookup.service';
import { runWithTenantContext } from '../modules/tenancy/tenant-context';
import { TenantTx } from '../modules/tenancy/tenant-tx.service';
import { buildDemoCatalogue, DemoProduct } from './demo-catalogue';
import { refuseDemoRun } from './demo-safety';
import { DEMO_PASSWORD, DEMO_SHOPS, DemoShop, demoGstin } from './demo-shops';

/**
 * Loads demo businesses into a LOCAL database so every screen has believable data to work with:
 * 3 businesses x 2 branches, 200 products each, 4 suppliers each, a year of monthly purchase bills per branch (so stock,
 * the stock ledger, weighted average cost and the audit log are all filled), short-dated stock, and low-stock levels.
 *
 * Run it with `pnpm db:seed:shops` (which first checks the database is local and NODE_ENV is not production).
 *
 * Why it calls the real services instead of writing rows directly: every rule (GSTIN check, price history, landed cost,
 * stock ledger, audit) then applies to demo data exactly as it does to real data, and a rule change can never leave the
 * demo data out of step with the product. Only the people (owner, admin, cashier) are written directly, because the
 * normal route needs an e-mail round trip.
 *
 * Safe to run twice: a business whose owner already exists is skipped. There is no invoice history yet because invoices
 * arrive with the till in Phase 2; the seed will grow a year of sales then.
 */

const INFO = { ip: '127.0.0.1', userAgent: 'dumbbill-demo-seed' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The four suppliers each demo business buys from (made-up companies; GSTINs are invented but pass the checks). */
const SUPPLIERS = [
  { name: 'Nutri Distributors Pvt Ltd', city: 'Mumbai', stateCode: '27', pan: 'AABCN6012D' },
  { name: 'Bharat Health Wholesale', city: 'New Delhi', stateCode: '07', pan: 'AAGFB2290L' },
  { name: 'SouthFit Traders', city: 'Bengaluru', stateCode: '29', pan: 'AAUFS8841Q' },
  { name: 'Apex Sports Imports LLP', city: 'Mumbai', stateCode: '27', pan: 'AAFFA1507H' },
];

/** Months of purchase history to create for each branch. */
const MONTHS = 12;

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** A small repeatable number generator so every run builds the same bills. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "YYYY-MM-DD" for a day offset from today (negative = past). */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Things every step needs. */
interface Toolbox {
  tenantTx: TenantTx;
  hasher: PasswordHasher;
  access: AccessService;
  business: BusinessService;
  branches: BranchesService;
  products: ProductsService;
  suppliers: SuppliersService;
  purchases: PurchasesService;
  stock: StockService;
}

async function seedShop(tools: Toolbox, shop: DemoShop, catalogue: DemoProduct[]): Promise<void> {
  const tenantId = uuid7();
  const ownerId = uuid7();
  const passwordHash = await tools.hasher.hash(DEMO_PASSWORD);
  const plan = 'GROWTH';

  // 1. The business, its built-in roles, first branch, categories and the owner and admin, in one transaction (like
  //    sign-up). The cashier is created LAST (step 3): the cashier's e-mail is the "this shop finished loading" marker.
  const { branchId: firstBranchId, cashierRoleId } = await tools.tenantTx.runAs(
    { tenantId, userId: ownerId },
    async (tx) => {
      const growth = await tx.plan.findUnique({ where: { code: plan } });
      if (!growth) throw new Error(`Reference data missing: run \`pnpm db:seed\` (plan ${plan}).`);
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: shop.name,
          planId: growth.id,
          trialEndsAt: new Date(Date.now() + 365 * DAY_MS),
        },
      });
      const { roleIds, branchId } = await createDefaultRolesAndBranch(tx, tenantId);
      await createDefaultCategories(tx, tenantId);
      const person = (role: 'OWNER' | 'ADMIN' | 'CASHIER', fullName: string, id?: string) => ({
        ...(id ? { id } : {}),
        tenantId,
        email: `${role.toLowerCase()}@${shop.emailDomain}`,
        fullName,
        passwordHash,
        status: 'ACTIVE' as const,
        isOwner: role === 'OWNER',
        roleId: roleIds[role],
        emailVerifiedAt: new Date(),
        passwordChangedAt: new Date(),
      });
      await tx.user.create({ data: person('OWNER', shop.ownerName, ownerId) });
      await tx.user.create({ data: person('ADMIN', shop.adminName) });
      return { branchId, cashierRoleId: roleIds.CASHIER };
    },
  );

  // 2. Everything else goes through the real services, as the owner.
  await runWithTenantContext({ tenantId, userId: ownerId }, async () => {
    const actor: LoadedAccess = await tools.access.load(ownerId);

    await tools.business.update(
      actor,
      {
        name: shop.name,
        stateCode: shop.stateCode,
        gstin: demoGstin(shop.stateCode, shop.pan, 1),
        city: shop.city,
        phone: shop.phone,
      },
      INFO,
    );
    const [first, second] = shop.branches;
    const branchIds: string[] = [firstBranchId];
    const branchFields = (branch: typeof first, entity: number) => ({
      name: branch.name,
      invoicePrefix: branch.prefix,
      printerWidthMm: 80 as const,
      stateCode: shop.stateCode,
      gstin: demoGstin(shop.stateCode, shop.pan, entity),
      addressLine: branch.addressLine,
      city: shop.city,
      pincode: branch.pincode,
      phone: branch.phone,
    });
    await tools.branches.update(actor, firstBranchId, branchFields(first, 2), INFO);
    branchIds.push((await tools.branches.create(actor, branchFields(second, 3), INFO)).id);

    // Suppliers.
    const supplierIds: string[] = [];
    for (const supplier of SUPPLIERS) {
      const created = await tools.suppliers.create(
        actor,
        {
          name: supplier.name,
          gstin: demoGstin(supplier.stateCode, supplier.pan, 1),
          city: supplier.city,
          phone: '9' + String(100_000_000 + supplierIds.length * 7_919_113).slice(0, 9),
        },
        INFO,
      );
      supplierIds.push(created.id);
    }

    // Products (with their first price), matched to the business's own categories by name.
    const categories = await tools.tenantTx.run((tx) => tx.productCategory.findMany());
    const categoryId = new Map(categories.map((category) => [category.name, category.id]));
    const productIds: string[] = [];
    for (const product of catalogue) {
      const created = await tools.products.create(
        actor,
        {
          name: product.name,
          brand: product.brand,
          variant: product.variant,
          categoryId: categoryId.get(product.category) ?? null,
          sku: product.sku,
          barcode: product.barcode,
          hsn: product.hsn,
          gstRateBp: product.gstRateBp,
          mrpPaise: product.mrpPaise,
          pricePaise: product.pricePaise,
        },
        INFO,
      );
      productIds.push(created.id);
    }

    // A year of monthly purchase bills per branch.
    const random = seededRandom(shop.code.charCodeAt(0) * 1000 + shop.code.charCodeAt(1));
    let bills = 0;
    for (const [branchIndex, branchId] of branchIds.entries()) {
      const branch = shop.branches[branchIndex] as typeof first;
      for (let monthsAgo = MONTHS - 1; monthsAgo >= 0; monthsAgo -= 1) {
        const invoiceDate = dayOffset(-(monthsAgo * 30 + 3));
        const start = (monthsAgo * 17 + branchIndex * 53) % catalogue.length;
        const lines = Array.from({ length: 18 }, (_unused, n) => {
          const index = (start + n * 7) % catalogue.length;
          const product = catalogue[index] as DemoProduct;
          const perishable =
            product.category !== 'Apparel' &&
            product.category !== 'Accessories (shakers, belts, gloves)';
          // The newest bill of the first branch holds three short-dated batches, to try the near-expiry alerts.
          const shortDated = monthsAgo === 0 && branchIndex === 0 && perishable && n < 3;
          return {
            productId: productIds[index] as string,
            qty: 6 + Math.floor(random() * 31),
            // Prices drift a little from month to month, like real supplier rates.
            unitCostPaise: Math.round(product.typicalCostPaise * (0.97 + random() * 0.06)),
            batchNo: perishable
              ? `${invoiceDate.slice(2, 4)}${invoiceDate.slice(5, 7)}-${branch.prefix}-${n + 1}`
              : null,
            expiryDate: perishable
              ? dayOffset(shortDated ? 25 : 200 + Math.floor(random() * 400))
              : null,
          };
        });
        const supplierId = supplierIds[(monthsAgo + branchIndex) % supplierIds.length] as string;
        await tools.purchases.create(
          actor,
          {
            supplierId,
            branchId,
            invoiceRef: `${shop.code}/${branch.prefix}/${invoiceDate.slice(0, 7)}`,
            invoiceDate,
            otherCostPaise: 80_000 + Math.floor(random() * 70_000),
            lines,
          },
          `demo-${shop.code}-${branch.prefix}-${invoiceDate}`,
          INFO,
        );
        bills += 1;
      }
    }

    // Low-stock levels on the fastest-looking products (every 7th), so the low-stock tab has something to say.
    for (const branchId of branchIds) {
      for (let index = 0; index < catalogue.length; index += 7) {
        await tools.stock.setThreshold(
          actor,
          { branchId, productId: productIds[index] as string, minQty: 20 },
          INFO,
        );
      }
    }
    // 3. The cashier, last. A cashier works in their own branch only (branch scope, US-ROLE-01).
    await tools.tenantTx.runAs({ tenantId, userId: ownerId }, async (tx) => {
      const cashier = await tx.user.create({
        data: {
          tenantId,
          email: `cashier@${shop.emailDomain}`,
          fullName: shop.cashierName,
          passwordHash,
          status: 'ACTIVE',
          isOwner: false,
          roleId: cashierRoleId,
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });
      await tx.userBranch.create({
        data: { tenantId, userId: cashier.id, branchId: firstBranchId },
      });
    });
    log(
      `  ${shop.name}: ${catalogue.length} products, ${SUPPLIERS.length} suppliers, ${bills} purchase bills, 2 branches.`,
    );
  });
}

async function main(): Promise<void> {
  // Checked here as well as in the package script: this file is part of the build and can be run directly.
  const refusal = refuseDemoRun(process.env, process.argv.includes('--allow-remote'));
  if (refusal) {
    process.stderr.write(`Refused: ${refusal}
`);
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const tools: Toolbox = {
      tenantTx: app.get(TenantTx),
      hasher: app.get(PasswordHasher),
      access: app.get(AccessService),
      business: app.get(BusinessService),
      branches: app.get(BranchesService),
      products: app.get(ProductsService),
      suppliers: app.get(SuppliersService),
      purchases: app.get(PurchasesService),
      stock: app.get(StockService),
    };
    const lookup = app.get(LoginLookup);
    const catalogue = buildDemoCatalogue();
    log('Loading demo businesses...');
    for (const shop of DEMO_SHOPS) {
      if (await lookup.findByEmail(`cashier@${shop.emailDomain}`)) {
        log(`  ${shop.name}: already loaded, skipped.`);
        continue;
      }
      if (await lookup.findByEmail(`owner@${shop.emailDomain}`)) {
        // An earlier run stopped part way. Loading again on top would clash, so say what to do instead.
        throw new Error(
          `${shop.name} was only partly loaded by an earlier run. Run \`pnpm db:reset\` and load again.`,
        );
      }
      await seedShop(tools, shop, catalogue);
    }
    log('');
    log(`Sign in with any demo address and the password "${DEMO_PASSWORD}":`);
    for (const shop of DEMO_SHOPS)
      log(`  ${shop.name}: owner@, admin@, cashier@${shop.emailDomain}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Demo seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
