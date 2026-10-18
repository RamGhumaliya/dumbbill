import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { TenantTx } from '../../src/modules/tenancy/tenant-tx.service';

/**
 * Builds a brand-new, empty PostgreSQL database for one test file, applies the REAL setup to it
 * (the role script and every migration), and deletes it afterwards.
 *
 * Why a real database instead of mocks: row-level security lives inside PostgreSQL. A mock cannot
 * prove that tenant A is unable to read tenant B's rows; only the real database can.
 *
 * It uses the PostgreSQL started by `docker compose up -d` and creates a separate database per
 * test file, so your development data is never touched.
 */
const ROOT = join(__dirname, '..', '..');

/** Owner connection to the server's maintenance database. Override with TEST_ADMIN_DATABASE_URL. */
const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://dumbbill:dumbbill@localhost:5432/postgres';

/** Credentials of the restricted app role, the same defaults as .env.example. */
const APP_USER = 'dumbbill_app';
const APP_PASSWORD = 'dumbbill_app';

export interface TestDatabase {
  /** Connection string of the restricted app role (what the running API would use). */
  appUrl: string;
  /** Connects as the OWNER. Can see everything; use only to inspect or to set up scenarios. */
  owner: PrismaClient;
  /** Connects as the restricted app role, exactly like the running API does. */
  app: PrismaService;
  /** The tenant-locked transaction helper, wired to the app role. */
  tenantTx: TenantTx;
  /** Disconnect and delete the database. Call in `afterAll`. */
  drop(): Promise<void>;
}

/** The same URL with a different database name. */
function withDatabase(url: string, database: string, user?: string, password?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user) parsed.username = user;
  if (password) parsed.password = password;
  return parsed.toString();
}

/** Run a Node script/CLI as a child process with the given database settings. */
function runNode(args: string[], env: Record<string, string>): void {
  execFileSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'pipe', // keep test output quiet; errors still throw with the captured output
  });
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `dumbbill_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);

  const ownerUrl = withDatabase(ADMIN_URL, name);
  const appUrl = withDatabase(ADMIN_URL, name, APP_USER, APP_PASSWORD);
  const env = { DATABASE_URL: ownerUrl, APP_DATABASE_URL: appUrl };

  // 1. Create the restricted role, 2. build the tables exactly as production would.
  runNode([join(ROOT, 'scripts', 'setup-db-roles.mjs')], env);
  runNode([join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], env);

  const owner = new PrismaClient({ datasourceUrl: ownerUrl });
  const app = new PrismaService({ getOrThrow: () => appUrl } as unknown as ConfigService);
  const tenantTx = new TenantTx(app);

  return {
    appUrl,
    owner,
    app,
    tenantTx,
    async drop() {
      await app.$disconnect();
      await owner.$disconnect();
      // FORCE disconnects any leftover connection so the drop cannot hang.
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}
