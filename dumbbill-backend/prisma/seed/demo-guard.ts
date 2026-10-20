/**
 * Safety check run BEFORE the demo businesses are loaded (`pnpm db:seed:shops`).
 *
 * Demo data creates fake businesses and fake purchases. Loading that into a real database would pollute real
 * customers' reports, so it is refused unless NODE_ENV is not "production" and the database is on this machine. The
 * rule itself lives in `safety.ts`, shared with `pnpm db:seed:demo`, so there is one definition of "safe".
 *
 * Exit code 0 means go ahead; anything else stops the command chain.
 */
import { checkSeedAllowed } from './safety';

const refusal = checkSeedAllowed(
  'demo',
  {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    APP_DATABASE_URL: process.env.APP_DATABASE_URL,
  },
  process.argv.includes('--allow-remote'),
);

if (refusal) {
  process.stderr.write(`Refused: ${refusal}\n`);
  process.exit(1);
}
