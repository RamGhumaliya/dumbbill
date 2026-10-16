import { PrismaClient } from '@prisma/client';

/**
 * The two kinds of seed data.
 *
 * - reference: data the product needs to work at all (plans, GST states, starter categories).
 *              Safe to run in every environment, including production.
 * - demo:      fake shops, products and sales for development and demos.
 *              Refused in production and on any non-local database.
 */
export type SeedGroup = 'reference' | 'demo';

/** What a seeder reports back, shown in the summary table. */
export interface SeedResult {
  /** Rows created for the first time. */
  created: number;
  /** Rows that already existed and were refreshed to match the seed data. */
  updated: number;
}

/**
 * One unit of seed work, usually one table.
 *
 * Rules every seeder must follow:
 * 1. IDEMPOTENT: running it twice gives the same database as running it once (use upsert, never plain insert).
 * 2. Only touch data it owns. It must never delete or overwrite data created by real users.
 * 3. Be deterministic: no random values, so every developer gets the same data.
 */
export interface Seeder {
  /** Unique name, used by `--only <name>`. */
  name: string;
  group: SeedGroup;
  /** Seeders run in ascending order, so a seeder can rely on tables filled by lower numbers. */
  order: number;
  run(prisma: PrismaClient): Promise<SeedResult>;
}
