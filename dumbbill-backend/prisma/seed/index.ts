/**
 * Seed command-line entry point. Normally you run it through the package scripts:
 *
 *   pnpm db:seed               reference data only (safe everywhere)
 *   pnpm db:seed:demo          reference + demo data (local database only)
 *   pnpm db:seed -- --only plans        run a single seeder
 *   pnpm db:seed -- --list              show available seeders
 *
 * Options after `--` are passed through by Prisma. See docs/runbooks/database-and-seeding.md.
 */
import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { runSeeders } from './runner';
import { ALL_SEEDERS } from './registry';
import { SeedGroup } from './types';

// The seed is a command-line tool, so writing straight to stdout is intentional here.
const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      group: { type: 'string', default: 'reference' }, // reference | demo | all
      only: { type: 'string' },
      'allow-remote': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.list) {
    ALL_SEEDERS.forEach((s) =>
      log(`${s.group.padEnd(10)} ${String(s.order).padStart(3)}  ${s.name}`),
    );
    return;
  }

  // "demo" always includes reference data too, because demo rows depend on it (plans, states ...).
  const groups: SeedGroup[] =
    values.group === 'demo' || values.group === 'all' ? ['reference', 'demo'] : ['reference'];

  const prisma = new PrismaClient();
  try {
    const summary = await runSeeders(prisma, ALL_SEEDERS, {
      groups,
      only: values.only,
      allowRemote: values['allow-remote'] ?? false,
      env: process.env,
      log,
    });
    const total = summary.reduce((n, s) => n + s.created + s.updated, 0);
    log(`Seed finished: ${summary.length} seeder(s), ${total} row(s) written.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
