import { PrismaClient } from '@prisma/client';

/**
 * The "RLS coverage audit": looks at the real database catalog and lists every table that is not
 * properly protected. It is the safety net that stops a developer from adding a tenant table and
 * forgetting its row-level security.
 *
 * The rule is strict on purpose: EVERY table must be either
 *   (a) on the explicit GLOBAL_TABLES list below (shared data with no owner), or
 *   (b) a tenant table: has its tenant column, RLS enabled AND forced, the standard policy, and
 *       day-to-day access granted to the app role.
 * A new table that is neither fails the audit, so adding one forces a conscious decision.
 */

/** Tables shared by every business. They hold no tenant data, so they have no tenant_id and no RLS. */
export const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  'plans',
  'gst_states',
  'category_templates',
  '_prisma_migrations', // Prisma's own bookkeeping; the app role must not even read it
]);

/** Tenant tables whose "owner" column is not called tenant_id. */
const TENANT_COLUMN_OVERRIDES: Readonly<Record<string, string>> = {
  tenants: 'id', // the tenants table: a row belongs to the tenant whose id it carries
};

interface TableRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  columns: string[];
  app_can_use: boolean;
}

interface PolicyRow {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

/** Returns human-readable problems. An empty list means every table is correctly protected. */
export async function findRlsViolations(
  db: PrismaClient,
  appRole = 'dumbbill_app',
): Promise<string[]> {
  const tables = await db.$queryRawUnsafe<TableRow[]>(
    `SELECT c.relname                       AS table_name,
            c.relrowsecurity                AS rls_enabled,
            c.relforcerowsecurity           AS rls_forced,
            ARRAY(SELECT a.attname FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
            has_table_privilege('${appRole}', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS app_can_use
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
  );
  const policies = await db.$queryRawUnsafe<PolicyRow[]>(
    `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public'`,
  );

  const problems: string[] = [];
  for (const table of tables) {
    const name = table.table_name;
    if (GLOBAL_TABLES.has(name)) continue;

    const column = TENANT_COLUMN_OVERRIDES[name] ?? 'tenant_id';
    if (!table.columns.includes(column)) {
      problems.push(
        `${name}: has no "${column}" column and is not on the GLOBAL_TABLES list. Add the column + enable_tenant_rls, or list it as global on purpose.`,
      );
      continue;
    }
    if (!table.rls_enabled) problems.push(`${name}: row-level security is not enabled.`);
    if (!table.rls_forced)
      problems.push(`${name}: row-level security is not FORCED (the table owner would bypass it).`);

    const policy = policies.find(
      (p) => p.tablename === name && p.policyname === 'tenant_isolation',
    );
    if (!policy) {
      problems.push(`${name}: the "tenant_isolation" policy is missing.`);
    } else {
      if (policy.cmd !== 'ALL')
        problems.push(`${name}: policy must apply to ALL commands (found ${policy.cmd}).`);
      if (!policy.qual?.includes('app_current_tenant_id') || !policy.qual.includes(column)) {
        problems.push(
          `${name}: policy USING clause does not compare "${column}" with app_current_tenant_id().`,
        );
      }
      if (!policy.with_check?.includes('app_current_tenant_id')) {
        problems.push(
          `${name}: policy has no WITH CHECK clause, so writes into other tenants would be possible.`,
        );
      }
    }
    if (!table.app_can_use) {
      problems.push(
        `${name}: the app role has no read/write access. Call app_grant_defaults() in the migration.`,
      );
    }
  }
  return problems;
}
