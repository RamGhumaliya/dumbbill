import { randomBytes } from 'node:crypto';
import { RateLimiter } from '../../src/modules/auth/rate-limit/rate-limiter.service';
import { RedisEphemeralStore } from '../../src/modules/auth/store/ephemeral-store';
import { RecordingLogger } from '../support/fakes';

/**
 * The production store talks to a real Redis (the one from `docker compose up -d`). The in-memory twin used by
 * the other tests is only trustworthy if the real thing behaves the same, so this checks the real one, and checks
 * the promise that rate limiting FAILS OPEN (sign-in keeps working) when Redis is unreachable.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('RedisEphemeralStore (real Redis)', () => {
  const store = new RedisEphemeralStore(REDIS_URL);
  /** Unique keys per run, so parallel runs and leftovers never interfere. */
  const key = (name: string): string => `test:${randomBytes(6).toString('hex')}:${name}`;

  afterAll(async () => {
    await store.onModuleDestroy();
    // The client closes its socket asynchronously; wait a moment so Jest does not report an open handle.
    await sleep(300);
  });

  it('counts up inside a window and reports the time left', async () => {
    const k = key('counter');
    expect(await store.increment(k, 30)).toMatchObject({ count: 1 });
    const second = await store.increment(k, 30);
    expect(second.count).toBe(2);
    expect(second.ttlSeconds).toBeGreaterThan(0);
    expect(second.ttlSeconds).toBeLessThanOrEqual(30);
    await store.delete(k);
  });

  it('forgets a counter when its window ends', async () => {
    const k = key('short');
    await store.increment(k, 1);
    await sleep(1300);
    expect((await store.increment(k, 1)).count).toBe(1);
    await store.delete(k);
  });

  it('remembers a key for a limited time, and can forget it early', async () => {
    const k = key('lock');
    expect(await store.remainingSeconds(k)).toBe(0);
    await store.set(k, 20);
    const left = await store.remainingSeconds(k);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(20);
    await store.delete(k);
    expect(await store.remainingSeconds(k)).toBe(0);
  });

  it('drives the real rate limiter: a lockout survives across store calls', async () => {
    const limiter = new RateLimiter(store, new RecordingLogger().asLogger());
    const email = `${randomBytes(6).toString('hex')}@lockout.test`;
    for (let i = 0; i < 5; i++) await limiter.recordLoginFailure(email);
    await expect(limiter.assertNotLocked(email)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await limiter.clearLoginFailures(email);
    await expect(limiter.assertNotLocked(email)).resolves.toBeUndefined();
  });
});

describe('when Redis is unreachable', () => {
  it('rate limiting fails OPEN: sign-in keeps working, and the problem is logged', async () => {
    // Nothing listens on port 1.
    const dead = new RedisEphemeralStore('redis://127.0.0.1:1');
    const logger = new RecordingLogger();
    const limiter = new RateLimiter(dead, logger.asLogger());
    try {
      await expect(limiter.hit('login:ip', '1.2.3.4', 1, 60)).resolves.toBeUndefined();
      await expect(limiter.assertNotLocked('a@b.in')).resolves.toBeUndefined();
      await expect(limiter.recordLoginFailure('a@b.in')).resolves.toBeUndefined();
      expect(logger.lines.some((line) => line.level === 'error')).toBe(true);
    } finally {
      await dead.onModuleDestroy();
      // A client that never connected winds down its reconnect timer asynchronously (up to a second or two).
      await sleep(2200);
    }
  });
});
