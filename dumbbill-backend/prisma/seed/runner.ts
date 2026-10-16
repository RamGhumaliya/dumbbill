import { PrismaClient } from '@prisma/client';
import { checkSeedAllowed } from './safety';
import { Seeder, SeedGroup } from './types';

export interface RunOptions {
  /** Which groups to run. */
  groups: SeedGroup[];
  /** Run only the seeder with this name. */
  only?: string;
  /** Permit demo data on a non-local database. */
  allowRemote: boolean;
  env: { NODE_ENV?: string; DATABASE_URL?: string };
  /** Where progress lines go. Injected so tests can capture output. */
  log: (line: string) => void;
}

export interface RunSummary {
  name: string;
  group: SeedGroup;
  created: number;
  updated: number;
}

/**
 * Run the chosen seeders in order and return what each one did.
 * Stops at the first failure so we never leave a half-seeded database unnoticed.
 */
export async function runSeeders(
  prisma: PrismaClient,
  seeders: readonly Seeder[],
  options: RunOptions,
): Promise<RunSummary[]> {
  const selected = seeders.filter(
    (s) => options.groups.includes(s.group) && (!options.only || s.name === options.only),
  );
  if (options.only && selected.length === 0) {
    const names = seeders.map((s) => s.name).join(', ');
    throw new Error(
      `No seeder named "${options.only}" in the selected groups. Available: ${names}`,
    );
  }

  // Check every REQUESTED group BEFORE running anything, so a refusal never leaves partial data.
  // We check what was asked for (not only groups that currently have seeders), so the rule
  // behaves the same today, while the demo group is empty, as it will once demo data exists.
  for (const group of options.groups) {
    const reason = checkSeedAllowed(group, options.env, options.allowRemote);
    if (reason) throw new Error(`Refusing to seed "${group}" data. ${reason}`);
  }

  const summaries: RunSummary[] = [];
  for (const seeder of selected) {
    options.log(`> ${seeder.group}/${seeder.name} ...`);
    const result = await seeder.run(prisma);
    options.log(`  created ${result.created}, updated ${result.updated}`);
    summaries.push({ name: seeder.name, group: seeder.group, ...result });
  }
  return summaries;
}
