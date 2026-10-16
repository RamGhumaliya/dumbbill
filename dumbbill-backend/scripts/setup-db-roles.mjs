// Creates (or refreshes) the restricted database role the running API connects as.
//
// WHY TWO ROLES?
//   owner / migrator  (DATABASE_URL)      creates tables, runs migrations and seeds. Powerful.
//   app role          (APP_DATABASE_URL)  used by the API while serving requests. It can read and write
//                                         rows but cannot change the structure, and it has NO right to
//                                         skip row-level security (NOBYPASSRLS). Even if application code
//                                         forgets a tenant filter, PostgreSQL still hides other tenants' rows.
//
// This script is safe to run any number of times. `pnpm db:migrate` and `pnpm db:deploy` run it first.
// It also works in production: set DATABASE_URL (owner) and APP_DATABASE_URL (app role + a strong password).
//
// Usage: node scripts/setup-db-roles.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Load .env by hand: this script runs before Prisma does, so nothing has loaded it yet.
// Values already in the real environment win over the file.
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
} catch {
  // No .env file: rely on the real environment.
}

const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!ownerUrl || !appUrl) {
  process.stderr.write('Both DATABASE_URL (owner) and APP_DATABASE_URL (app role) must be set.\n');
  process.exit(1);
}

const owner = new URL(ownerUrl);
const app = new URL(appUrl);
const roleName = decodeURIComponent(app.username);
const rolePassword = decodeURIComponent(app.password);

// The role name and password are placed into SQL text (SQL cannot take them as parameters here),
// so they are strictly checked first. This blocks SQL injection through the settings file.
if (!/^[a-z][a-z0-9_]{2,62}$/.test(roleName)) {
  process.stderr.write(`APP_DATABASE_URL user "${roleName}" must be lowercase letters, digits and underscores.\n`);
  process.exit(1);
}
if (rolePassword.length < 8) {
  process.stderr.write('APP_DATABASE_URL password must be at least 8 characters.\n');
  process.exit(1);
}
if (roleName === decodeURIComponent(owner.username)) {
  process.stderr.write('APP_DATABASE_URL must use a different user than DATABASE_URL (the app must not run as the owner).\n');
  process.exit(1);
}
const passwordLiteral = `'${rolePassword.replaceAll("'", "''")}'`;
const dbName = owner.pathname.slice(1);
const ownerName = decodeURIComponent(owner.username);

const prisma = new PrismaClient({ datasourceUrl: ownerUrl });

try {
  // 1. Create the role if it does not exist yet. Created as NOLOGIN first; login is enabled below.
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
        CREATE ROLE ${roleName} NOLOGIN;
      END IF;
    END $$;`);

  // 2. (Re)apply the security attributes every time, so drift is repaired.
  //    NOBYPASSRLS is the important one: this role can never skip row-level security.
  await prisma.$executeRawUnsafe(
    `ALTER ROLE ${roleName} WITH LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
  );

  // 3. Allow connecting to this database and using (but not changing) the public schema.
  await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${dbName.replaceAll('"', '""')}" TO ${roleName}`);
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
  await prisma.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${roleName}`);

  // 4. Tables the owner creates in future automatically get the app role's day-to-day rights.
  //    (Each migration also calls app_grant_defaults(), so a database reset cannot lose these.)
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerName.replaceAll('"', '""')}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roleName}`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerName.replaceAll('"', '""')}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${roleName}`,
  );

  // 5. If migrations already ran, apply the grants to the existing tables too.
  const fn = await prisma.$queryRawUnsafe(`SELECT to_regproc('app_grant_defaults')::text AS fn`);
  if (fn[0]?.fn) await prisma.$executeRawUnsafe(`SELECT app_grant_defaults('${roleName}')`);

  process.stdout.write(`Database role "${roleName}" is ready (login, no superuser, no RLS bypass).\n`);
} finally {
  await prisma.$disconnect();
}
