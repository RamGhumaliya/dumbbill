import { SeedGroup } from './types';

/** Hosts we treat as "my own machine". Demo data and resets are only allowed against these. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/** Pull the host name out of a PostgreSQL connection string. Returns null if it cannot be read. */
export function hostFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Decide whether a seed run is allowed. Returns a human-readable reason if it is NOT allowed.
 *
 * Why this exists: demo data creates fake businesses and fake sales. Loading that into a real
 * database by accident would pollute real customers' reports. So demo data is only allowed when
 * BOTH are true: NODE_ENV is not "production", and the database is on this machine.
 * Reference data has no such restriction because it is required in production too.
 */
export function checkSeedAllowed(
  group: SeedGroup,
  env: { NODE_ENV?: string; DATABASE_URL?: string },
  allowRemote: boolean,
): string | null {
  if (group === 'reference') return null;

  if (env.NODE_ENV === 'production') {
    return 'Demo data is never loaded when NODE_ENV=production.';
  }
  const host = hostFromDatabaseUrl(env.DATABASE_URL);
  if (!allowRemote && (host === null || !LOCAL_HOSTS.has(host))) {
    return `Demo data is only loaded into a local database (found host "${host ?? 'unknown'}"). Pass --allow-remote if you are sure.`;
  }
  return null;
}
