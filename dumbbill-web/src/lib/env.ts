import { parseEnv, type Env } from './env-schema';

export type { Env };

/**
 * The validated settings of this running app, read from the environment once at start-up.
 * If one is missing or malformed, the build/start fails with a clear list of problems.
 *
 * Only NEXT_PUBLIC_ variables exist here. They are copied into the browser code, so they are visible to
 * everyone using the site: never put a secret in one. Each is spelled out in full because Next.js
 * replaces `process.env.NEXT_PUBLIC_X` literally at build time (looping over process.env would not work
 * in the browser).
 */
export const env: Env = parseEnv({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
