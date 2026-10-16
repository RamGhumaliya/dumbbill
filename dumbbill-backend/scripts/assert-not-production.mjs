// Safety check run before destructive database commands (reset).
// It stops the command if the environment looks like production or the database is not on this machine.
import { readFileSync } from 'node:fs';

// Load .env by hand: this script runs before Prisma does, so nothing has loaded it yet.
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
} catch {
  // No .env file: rely on the real environment.
}

const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
let host = null;
try {
  host = new URL(process.env.DATABASE_URL ?? '').hostname;
} catch {
  // leave host as null
}

if (process.env.NODE_ENV === 'production' || host === null || !localHosts.has(host)) {
  process.stderr.write(
    `Refusing to run: this command deletes all data and only works on a local, non-production database.\n` +
      `NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}, database host=${host ?? 'unreadable'}\n`,
  );
  process.exit(1);
}
