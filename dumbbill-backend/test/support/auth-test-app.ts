import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { Clock } from '../../src/common/clock';
import { BreachChecker } from '../../src/modules/auth/password/breach-checker';
import { EphemeralStore, MemoryEphemeralStore } from '../../src/modules/auth/store/ephemeral-store';
import { Mailer, MemoryMailer } from '../../src/modules/mail/mailer';
import { FakeClock } from './fakes';
import { applyTestEnvironment } from './test-env';
import { createTestDatabase, TestDatabase } from './test-database';

/**
 * A complete, real copy of the API for end-to-end tests: the real modules, real PostgreSQL (a throwaway
 * database with all migrations and row-level security), the real validation, error format and guards.
 *
 * Only four things are swapped for test versions, because they would otherwise need the outside world:
 *   - the clock         (tests move time forward to test expiry and lockouts),
 *   - Redis             (an in-memory store with the same behaviour),
 *   - email             (messages are kept in a list so tests can read the links),
 *   - the breach check  (no network; tests choose which passwords count as breached).
 */
export interface AuthTestApp {
  app: INestApplication;
  db: TestDatabase;
  clock: FakeClock;
  mailer: MemoryMailer;
  /** Passwords the fake breach service reports as breached. */
  breached: Set<string>;
  /** A fresh visitor address, so each test starts under the per-IP rate limits. */
  freshIp(): string;
  /** An HTTP caller. Pass `ip` to act as that visitor. */
  http(): ReturnType<typeof request>;
  close(): Promise<void>;
}

/** A password that passes every rule. */
export const STRONG_PASSWORD = 'violet harbour 4 lantern';

export async function createAuthTestApp(
  options: { extraControllers?: Type<unknown>[] } = {},
): Promise<AuthTestApp> {
  const db = await createTestDatabase();
  // Settings must exist BEFORE the app module is loaded (it validates them when imported).
  applyTestEnvironment({ APP_DATABASE_URL: db.appUrl, TRUST_PROXY_HOPS: '1' });

  // Reference data the signup flow needs (normally loaded by `pnpm db:seed`).
  await db.owner.plan.create({
    // 25 seats so ordinary tests are not blocked by the plan limit; the plan-limit test lowers it on purpose.
    data: { code: 'STARTER', name: 'Starter', maxBranches: 1, maxUsers: 25, trialDays: 14 },
  });

  const clock = new FakeClock();
  const mailer = new MemoryMailer();
  const breached = new Set<string>();
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.extraControllers ?? [],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(EphemeralStore)
    .useValue(new MemoryEphemeralStore(clock))
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(BreachChecker)
    .useValue({ isBreached: async (password: string) => breached.has(password) })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  let counter = 0;
  return {
    app,
    db,
    clock,
    mailer,
    breached,
    freshIp: () => `10.${Math.floor(++counter / 250)}.${counter % 250}.${(counter * 7) % 250}`,
    http: () => request(app.getHttpServer()),
    async close() {
      await app.close();
      await db.drop();
    },
  };
}

/** The token inside the first link of an email (`...?token=<value>`). */
export function tokenFromEmail(text: string): string {
  const match = /token=([^\s"&]+)/.exec(text);
  if (!match) throw new Error('No token link in the email.');
  return decodeURIComponent(match[1]!);
}
