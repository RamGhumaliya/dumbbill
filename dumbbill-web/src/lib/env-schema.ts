import { z } from 'zod';

/**
 * The rules for the settings this app reads from its environment (see ./env.ts for the live values).
 * Kept separate from env.ts so tests can check the rules with their own values, without needing a real .env file.
 *
 * The settings are checked once when the app starts.
 *
 * If one is missing or malformed the build/start fails with a clear list of problems, instead of the
 * app breaking later in front of a customer.
 *
 * Only NEXT_PUBLIC_ variables exist here. They are copied into the browser code, so they are visible
 * to everyone using the site: never put a secret in one. Each is spelled out in full below because
 * Next.js replaces `process.env.NEXT_PUBLIC_X` literally at build time (looping over process.env
 * would not work in the browser).
 */
const schema = z.object({
  /** Address of the Dumbbill API, for example http://localhost:3000. */
  NEXT_PUBLIC_API_BASE_URL: z.url(),
  /** Release name written on error reports. */
  NEXT_PUBLIC_APP_VERSION: z.string().min(1),
  /** Sentry project address. Empty or missing switches error tracking off. */
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
});

export type Env = z.infer<typeof schema> & {
  /** "dev" while developing, "prod" for the live site. There are only these two environments. */
  APP_ENV: 'dev' | 'prod';
};

/** Check a set of raw values and return clean settings. Exported so tests can try bad values. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  // An empty string in a .env file means "not set".
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, value?.trim() || undefined]),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\nSee .env.development.example.`,
    );
  }
  return { ...result.data, APP_ENV: process.env.NODE_ENV === 'production' ? 'prod' : 'dev' };
}
