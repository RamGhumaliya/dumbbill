import Redis from 'ioredis';
import { Clock } from '../../../common/clock';

/**
 * A tiny key-value store for short-lived facts: "this address tried 5 times this minute",
 * "this account is locked for 2 more minutes", "this session was ended".
 *
 * Everything in it EXPIRES BY ITSELF, which is exactly what rate limits and lockouts need. It is kept
 * out of the main database on purpose: these facts change on every request and nobody needs them after
 * a few minutes. Production uses Redis; automated tests use the in-memory twin below (same behaviour,
 * no network, and a fake clock can make time pass).
 */
export abstract class EphemeralStore {
  /**
   * Add one to a counter. The counter starts the clock on its first increment and disappears
   * `ttlSeconds` later (a "fixed window"). Returns the new count and the seconds left.
   */
  abstract increment(
    key: string,
    ttlSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }>;

  /** Remember a key for `ttlSeconds`. */
  abstract set(key: string, ttlSeconds: number): Promise<void>;

  /** Seconds left before the key expires; 0 when it is not there. */
  abstract remainingSeconds(key: string): Promise<number>;

  /** Forget a key now. */
  abstract delete(key: string): Promise<void>;
}

/** All our keys start with this, so they never collide with anything else stored in the same Redis. */
const KEY_PREFIX = 'dumbbill:auth:';

/** The production store, backed by Redis. */
export class RedisEphemeralStore extends EphemeralStore {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    super();
    // lazyConnect: do not connect until first use, so the app (and tests) start even if Redis is slow.
    // maxRetriesPerRequest: fail a request quickly when Redis is down instead of hanging the login.
    this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    // Without a listener, ioredis throws connection errors as uncaught exceptions. The callers already
    // handle failed commands (they fail open), so here we only keep the process alive.
    this.redis.on('error', () => undefined);
  }

  async increment(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    const full = KEY_PREFIX + key;
    const count = await this.redis.incr(full);
    let remaining = await this.redis.ttl(full);
    if (remaining < 0) {
      // First hit (or a key that lost its expiry): start the window.
      await this.redis.expire(full, ttlSeconds);
      remaining = ttlSeconds;
    }
    return { count, ttlSeconds: remaining };
  }

  async set(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(KEY_PREFIX + key, '1', 'EX', Math.max(1, Math.ceil(ttlSeconds)));
  }

  async remainingSeconds(key: string): Promise<number> {
    return Math.max(0, await this.redis.ttl(KEY_PREFIX + key));
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + key);
  }

  /**
   * Close the connection politely (finish pending commands, tell Redis we are leaving). Nest calls this when the
   * app shuts down. If Redis cannot be reached `quit` fails or stalls, so it is given half a second, then the
   * socket is simply dropped: shutting down must never hang on a store that is already gone.
   */
  async onModuleDestroy(): Promise<void> {
    const stalled = new Promise<void>((resolve) => setTimeout(resolve, 500).unref());
    try {
      await Promise.race([this.redis.quit().then(() => undefined), stalled]);
    } catch {
      // Not connected: nothing to say goodbye to.
    } finally {
      this.redis.disconnect();
    }
  }
}

/** The in-memory twin used by automated tests. Uses the injected clock so tests can move time forward. */
export class MemoryEphemeralStore extends EphemeralStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly clock: Clock) {
    super();
  }

  /** The live entry for a key, dropping it if it has expired. */
  private live(key: string): { count: number; expiresAt: number } | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.clock.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async increment(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    const now = this.clock.now().getTime();
    const entry = this.live(key) ?? { count: 0, expiresAt: now + ttlSeconds * 1000 };
    entry.count += 1;
    this.entries.set(key, entry);
    return { count: entry.count, ttlSeconds: Math.ceil((entry.expiresAt - now) / 1000) };
  }

  async set(key: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { count: 1, expiresAt: this.clock.now().getTime() + ttlSeconds * 1000 });
  }

  async remainingSeconds(key: string): Promise<number> {
    const entry = this.live(key);
    return entry ? Math.ceil((entry.expiresAt - this.clock.now().getTime()) / 1000) : 0;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
