import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The environment variables the app needs when started inside a test.
 *
 * `NODE_ENV=production` is used on purpose: it switches the logger to plain JSON (no pretty-printing worker
 * thread). The price is that the app's production safety checks apply, so this helper supplies throw-away
 * secrets that satisfy them: a fresh signing key, an encryption key and a long pepper, all generated here and
 * never reused anywhere else.
 *
 * Password hashing is made cheap (8 MB, 1 pass) so tests that sign in many times stay fast. The production
 * safety check on that setting is satisfied by temporarily being above its floor only when NODE_ENV is
 * production, so tests that need the cheap setting use `NODE_ENV=test` instead (see `applyTestEnvironment`).
 */
export function applyTestEnvironment(overrides: Record<string, string> = {}): void {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  Object.assign(process.env, {
    NODE_ENV: 'production',
    // Quiet by default; set TEST_LOG_LEVEL=error (or debug) to see what the app logs while a test runs.
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'fatal',
    APP_DATABASE_URL: 'postgresql://app:app@localhost:5432/unused',
    REDIS_URL: 'redis://localhost:6379',
    WEB_BASE_URL: 'https://app.example.test',
    CORS_ALLOWED_ORIGINS: 'https://app.example.test',
    JWT_PRIVATE_KEY: Buffer.from(pem).toString('base64'),
    JWT_KEY_ID: 'test-key-1',
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PASSWORD_PEPPERS: `1:${randomBytes(24).toString('hex')}`,
    PASSWORD_BREACH_CHECK: 'false',
    // The production floor for password hashing memory is 19456 KiB; tests stay just above it.
    ARGON2_MEMORY_KIB: '19456',
    ARGON2_TIME_COST: '1',
    // Uploaded files from tests go to the system temp folder, never into the project's own storage folder.
    STORAGE_LOCAL_DIR: join(tmpdir(), 'dumbbill-test-storage'),
    ...overrides,
  });
}
