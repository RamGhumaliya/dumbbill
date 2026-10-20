import { hostFromDatabaseUrl, refuseDemoRun } from '../../src/demo/demo-safety';
import { SeedGroup } from './types';

export { hostFromDatabaseUrl };

/**
 * Decide whether a seed run is allowed. Returns a human-readable reason if it is NOT allowed.
 *
 * Why this exists: demo data creates fake businesses and fake sales. Loading that into a real
 * database by accident would pollute real customers' reports. So demo data is only allowed when
 * BOTH are true: NODE_ENV is not "production", and every database URL is on this machine (see `demo-safety.ts`).
 * Reference data has no such restriction because it is required in production too.
 */
export function checkSeedAllowed(
  group: SeedGroup,
  env: { NODE_ENV?: string; DATABASE_URL?: string; APP_DATABASE_URL?: string },
  allowRemote: boolean,
): string | null {
  if (group === 'reference') return null;

  return refuseDemoRun(env, allowRemote);
}
