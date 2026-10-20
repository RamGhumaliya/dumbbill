/**
 * The one definition of "safe to load demo data", shared by the demo loader (`src/demo/main.ts`) and the seed tools
 * under `prisma/seed`.
 *
 * Demo data creates fake businesses whose password is published in the docs. Loading it into a real database would
 * put known logins into production, so a run is refused unless NODE_ENV is not "production" AND every database the
 * run could write to is on this machine. "Every database" matters: the owner connection (DATABASE_URL) and the
 * restricted app connection (APP_DATABASE_URL) can point at different servers, and the loader writes through the
 * app one. The loader is compiled into `dist/`, so it checks for itself instead of trusting the package script.
 */

/** Hosts we treat as "my own machine". */
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

/** The connection strings a demo run could touch. */
export interface DemoRunEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  APP_DATABASE_URL?: string;
}

/**
 * Returns a human-readable reason when demo data must NOT be loaded, or null when it may.
 * `allowRemote` lifts only the "local database" rule, never the production rule.
 */
export function refuseDemoRun(env: DemoRunEnv, allowRemote: boolean): string | null {
  if (env.NODE_ENV === 'production') {
    return 'Demo data is never loaded when NODE_ENV=production.';
  }
  if (allowRemote) return null;
  // A missing APP_DATABASE_URL is fine (the app falls back to the owner URL); a present one must be local too.
  const urls = [env.DATABASE_URL, env.APP_DATABASE_URL].filter((url) => url !== undefined);
  for (const url of urls.length ? urls : [undefined]) {
    const host = hostFromDatabaseUrl(url);
    if (host === null || !LOCAL_HOSTS.has(host)) {
      return `Demo data is only loaded into a local database (found host "${host ?? 'unknown'}"). Pass --allow-remote if you are sure.`;
    }
  }
  return null;
}
