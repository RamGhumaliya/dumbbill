import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { DomainError } from '../../src/common/errors/domain-error';
import { SecretCipher } from '../../src/modules/auth/crypto/secret-cipher.service';
import { HibpBreachChecker } from '../../src/modules/auth/password/breach-checker';
import { PasswordHasher } from '../../src/modules/auth/password/password-hasher.service';
import { RateLimiter } from '../../src/modules/auth/rate-limit/rate-limiter.service';
import { MemoryEphemeralStore } from '../../src/modules/auth/store/ephemeral-store';
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  AccessTokenService,
} from '../../src/modules/auth/tokens/access-token.service';
import { escapeHtml, verificationEmail } from '../../src/modules/mail/auth-emails';
import { fakeConfig, FakeClock, RecordingLogger } from '../support/fakes';

/** Cheap hashing settings so the tests stay fast; the algorithm and behaviour are identical to production. */
const CHEAP = { ARGON2_MEMORY_KIB: 8, ARGON2_TIME_COST: 1 };
const quiet = new RecordingLogger().asLogger();

function hasherWith(peppers: string, extra: Record<string, unknown> = {}): PasswordHasher {
  return new PasswordHasher(fakeConfig({ PASSWORD_PEPPERS: peppers, ...CHEAP, ...extra }), quiet);
}

describe('PasswordHasher', () => {
  it('stores an Argon2id hash tagged with the pepper version, never the password', async () => {
    const stored = await hasherWith('1:pepper-one').hash('violet harbour 4 lantern');
    expect(stored).toMatch(/^v1:\$argon2id\$/);
    expect(stored).not.toContain('violet');
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const hasher = hasherWith('1:pepper-one');
    const stored = await hasher.hash('violet harbour 4 lantern');
    expect((await hasher.verify(stored, 'violet harbour 4 lantern')).valid).toBe(true);
    expect((await hasher.verify(stored, 'violet harbour 4 lanterns')).valid).toBe(false);
  });

  it('the same password gets a different hash each time (random salt)', async () => {
    const hasher = hasherWith('1:pepper-one');
    expect(await hasher.hash('same password here')).not.toBe(
      await hasher.hash('same password here'),
    );
  });

  it('the pepper matters: a database copied WITHOUT the server secret cannot be checked', async () => {
    const stored = await hasherWith('1:pepper-one').hash('violet harbour 4 lantern');
    const thief = hasherWith('1:a-different-pepper');
    expect((await thief.verify(stored, 'violet harbour 4 lantern')).valid).toBe(false);
  });

  it('keeps old passwords working after a pepper rotation, and asks for a re-hash', async () => {
    const before = hasherWith('1:pepper-one');
    const stored = await before.hash('violet harbour 4 lantern');
    const after = hasherWith('1:pepper-one,2:pepper-two');
    const check = await after.verify(stored, 'violet harbour 4 lantern');
    expect(check).toEqual({ valid: true, needsRehash: true });
    const upgraded = await after.hash('violet harbour 4 lantern');
    expect(upgraded.startsWith('v2:')).toBe(true);
    expect(await after.verify(upgraded, 'violet harbour 4 lantern')).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('asks for a re-hash when the cost settings were raised', async () => {
    const weak = hasherWith('1:p', { ARGON2_MEMORY_KIB: 8, ARGON2_TIME_COST: 1 });
    const strong = hasherWith('1:p', { ARGON2_MEMORY_KIB: 16, ARGON2_TIME_COST: 2 });
    const stored = await weak.hash('some long password');
    expect((await strong.verify(stored, 'some long password')).needsRehash).toBe(true);
  });

  it('treats damaged or unknown stored values as "wrong password", never as a crash', async () => {
    const hasher = hasherWith('1:pepper-one');
    for (const junk of [
      '',
      'plaintext',
      'v1:not-a-hash',
      'v9:$argon2id$v=19$m=8,t=1,p=1$AAAA$BBBB',
      '$argon2id$v=19$m=8,t=1,p=1$AAAA$BBBB',
    ]) {
      expect(await hasher.verify(junk, 'anything')).toEqual({ valid: false, needsRehash: false });
    }
  });

  it('burnTime works without error (used to hide whether an email exists)', async () => {
    await expect(hasherWith('1:p').burnTime('whatever')).resolves.toBeUndefined();
  });

  it('refuses a malformed pepper setting at start-up', () => {
    expect(() => hasherWith('secret-without-version')).toThrow(/PASSWORD_PEPPERS/);
  });

  it('warns when it falls back to the development pepper', () => {
    const logger = new RecordingLogger();
    new PasswordHasher(fakeConfig({ ...CHEAP }), logger.asLogger());
    expect(JSON.stringify(logger.lines)).toMatch(/PASSWORD_PEPPERS is not set/);
  });
});

describe('SecretCipher', () => {
  const key = randomBytes(32).toString('base64');
  const cipher = new SecretCipher(fakeConfig({ DATA_ENCRYPTION_KEY: key }), quiet);

  it('round-trips text and never stores it readable', () => {
    const stored = cipher.encrypt('JBSWY3DPEHPK3PXP');
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(stored)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh nonce every time', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('detects tampering instead of returning garbage', () => {
    const parts = cipher.encrypt('secret value').split('.');
    parts[3] = Buffer.from('tampered!!!!').toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
  });

  it('cannot be read with a different key', () => {
    const other = new SecretCipher(
      fakeConfig({ DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
      quiet,
    );
    expect(() => other.decrypt(cipher.encrypt('secret value'))).toThrow();
  });

  it('refuses a key of the wrong size', () => {
    expect(() => new SecretCipher(fakeConfig({ DATA_ENCRYPTION_KEY: 'c2hvcnQ=' }), quiet)).toThrow(
      /32 bytes/,
    );
  });
});

describe('AccessTokenService', () => {
  const claims = { userId: 'user-1', tenantId: 'tenant-1', sessionId: 'session-1' };

  function service(clock: FakeClock, extra: Record<string, unknown> = {}): AccessTokenService {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    return new AccessTokenService(
      fakeConfig({
        JWT_KEY_ID: 'k1',
        JWT_PRIVATE_KEY: Buffer.from(pem).toString('base64'),
        ...extra,
      }),
      clock,
      quiet,
    );
  }

  it('signs a token that verifies back to the same claims, valid for 15 minutes', async () => {
    const clock = new FakeClock();
    const tokens = service(clock);
    const { token, expiresInSeconds } = await tokens.sign(claims);
    expect(expiresInSeconds).toBe(ACCESS_TOKEN_LIFETIME_SECONDS);
    expect(ACCESS_TOKEN_LIFETIME_SECONDS).toBe(900);
    expect(await tokens.verify(token)).toEqual(claims);
  });

  it('stops working after it expires', async () => {
    const clock = new FakeClock();
    const tokens = service(clock);
    const { token } = await tokens.sign(claims);
    clock.advanceSeconds(ACCESS_TOKEN_LIFETIME_SECONDS - 5);
    expect(await tokens.verify(token)).not.toBeNull();
    clock.advanceSeconds(10);
    expect(await tokens.verify(token)).toBeNull();
  });

  it('rejects a token that was changed after signing', async () => {
    const tokens = service(new FakeClock());
    const { token } = await tokens.sign(claims);
    const [header, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
        tid: 'another-business',
      }),
    ).toString('base64url');
    expect(await tokens.verify(`${header}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it('rejects a token signed by a different key (even with our key id)', async () => {
    const clock = new FakeClock();
    const ours = service(clock);
    const attacker = service(clock); // a different random key, same key id "k1"
    const { token } = await attacker.sign(claims);
    expect(await ours.verify(token)).toBeNull();
  });

  it('rejects a token made for another audience (a customer token cannot open staff routes)', async () => {
    const clock = new FakeClock();
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const tokens = new AccessTokenService(
      fakeConfig({ JWT_KEY_ID: 'k1', JWT_PRIVATE_KEY: Buffer.from(pem).toString('base64') }),
      clock,
      quiet,
    );
    const now = Math.floor(clock.now().getTime() / 1000);
    const customerToken = await new SignJWT({ tid: 't', sid: 's' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setSubject('customer-1')
      .setIssuer('dumbbill')
      .setAudience('dumbbill-customer')
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(privateKey);
    expect(await tokens.verify(customerToken)).toBeNull();
  });

  it('rejects "alg: none" and garbage', async () => {
    const tokens = service(new FakeClock());
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x","tid":"t","sid":"s"}').toString('base64url')}.`;
    expect(await tokens.verify(none)).toBeNull();
    for (const junk of ['', 'abc', 'a.b.c', 'Bearer x'])
      expect(await tokens.verify(junk)).toBeNull();
  });

  it('survives a key rotation: tokens signed with the old key still verify while its public key is listed', async () => {
    const clock = new FakeClock();
    const oldPair = generateKeyPairSync('ed25519');
    const oldPem = oldPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const oldService = new AccessTokenService(
      fakeConfig({ JWT_KEY_ID: 'old', JWT_PRIVATE_KEY: Buffer.from(oldPem).toString('base64') }),
      clock,
      quiet,
    );
    const { token } = await oldService.sign(claims);

    const oldPublic = oldPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const rotated = service(clock, {
      JWT_KEY_ID: 'new',
      JWT_PREVIOUS_PUBLIC_KEYS: `old:${Buffer.from(oldPublic).toString('base64')}`,
    });
    expect(await rotated.verify(token)).toEqual(claims);
    // ...and once the old key is removed from the list, its tokens stop working.
    expect(await service(clock, { JWT_KEY_ID: 'new' }).verify(token)).toBeNull();
  });
});

describe('RateLimiter', () => {
  function limiter(
    clock = new FakeClock(),
    store = new MemoryEphemeralStore(clock),
  ): { limiter: RateLimiter; clock: FakeClock; store: MemoryEphemeralStore } {
    return { limiter: new RateLimiter(store, quiet), clock, store };
  }

  async function rejection(promise: Promise<void>): Promise<DomainError> {
    try {
      await promise;
    } catch (error) {
      return error as DomainError;
    }
    throw new Error('expected the call to be refused');
  }

  it('allows requests up to the limit and refuses the next with a Retry-After header', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 3; i++) await l.hit('test', '1.2.3.4', 3, 60);
    const error = await rejection(l.hit('test', '1.2.3.4', 3, 60));
    expect(error.code).toBe('RATE_LIMITED');
    expect(Number(error.headers?.['Retry-After'])).toBeGreaterThan(0);
  });

  it('counts each visitor separately', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 3; i++) await l.hit('test', '1.1.1.1', 3, 60);
    await expect(l.hit('test', '2.2.2.2', 3, 60)).resolves.toBeUndefined();
  });

  it('starts again when the window ends', async () => {
    const { limiter: l, clock } = limiter();
    for (let i = 0; i < 3; i++) await l.hit('test', 'x', 3, 60);
    clock.advanceSeconds(61);
    await expect(l.hit('test', 'x', 3, 60)).resolves.toBeUndefined();
  });

  it('locks an account after 5 wrong passwords, for longer each time, and unlocks by itself', async () => {
    const { limiter: l, clock } = limiter();
    for (let i = 0; i < 4; i++) {
      await l.recordLoginFailure('a@b.in');
      await expect(l.assertNotLocked('a@b.in')).resolves.toBeUndefined();
    }
    await l.recordLoginFailure('a@b.in'); // the 5th
    const locked = await rejection(l.assertNotLocked('a@b.in'));
    expect(locked.code).toBe('RATE_LIMITED');
    expect(locked.headers?.['Retry-After']).toBe('60');

    clock.advanceSeconds(61);
    await expect(l.assertNotLocked('a@b.in')).resolves.toBeUndefined();
    await l.recordLoginFailure('a@b.in'); // the 6th: two minutes now
    expect((await rejection(l.assertNotLocked('a@b.in'))).headers?.['Retry-After']).toBe('120');
  });

  it('a successful sign-in clears the failures', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 5; i++) await l.recordLoginFailure('a@b.in');
    await l.clearLoginFailures('a@b.in');
    await expect(l.assertNotLocked('a@b.in')).resolves.toBeUndefined();
  });

  it('does not tell the email addresses of real accounts apart: unknown emails lock too', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 5; i++) await l.recordLoginFailure('nobody@nowhere.test');
    await expect(l.assertNotLocked('nobody@nowhere.test')).rejects.toBeInstanceOf(DomainError);
  });

  it('treats email addresses case-insensitively', async () => {
    const { limiter: l } = limiter();
    for (let i = 0; i < 5; i++) await l.recordLoginFailure('Ravi@Shop.IN');
    await expect(l.assertNotLocked('ravi@shop.in')).rejects.toBeInstanceOf(DomainError);
  });

  it('keeps no readable email or IP in its keys', async () => {
    const { limiter: l, store } = limiter();
    const seen: string[] = [];
    const original = store.increment.bind(store);
    store.increment = async (key, ttl) => {
      seen.push(key);
      return original(key, ttl);
    };
    await l.hit('login:ip', '203.0.113.9', 10, 60);
    await l.recordLoginFailure('ravi@fitfuel.in');
    expect(seen.join(' ')).not.toMatch(/203\.0\.113\.9|ravi|fitfuel/);
  });

  it('does nothing at all when switched off for development (no limits, no lockout)', async () => {
    const clock = new FakeClock();
    const logger = new RecordingLogger();
    const l = new RateLimiter(new MemoryEphemeralStore(clock), logger.asLogger(), true);
    for (let i = 0; i < 20; i++) await l.hit('test', 'x', 1, 60);
    for (let i = 0; i < 20; i++) await l.recordLoginFailure('a@b.in');
    await expect(l.assertNotLocked('a@b.in')).resolves.toBeUndefined();
    expect(JSON.stringify(logger.lines)).toMatch(/RATE_LIMIT_DISABLED is on/);
  });

  it('fails OPEN when the store is down: sign-in keeps working and the problem is logged', async () => {
    const broken = new MemoryEphemeralStore(new FakeClock());
    broken.increment = async () => {
      throw new Error('redis is down');
    };
    broken.remainingSeconds = async () => {
      throw new Error('redis is down');
    };
    const logger = new RecordingLogger();
    const l = new RateLimiter(broken, logger.asLogger());
    await expect(l.hit('x', 'y', 1, 60)).resolves.toBeUndefined();
    await expect(l.assertNotLocked('a@b.in')).resolves.toBeUndefined();
    await expect(l.recordLoginFailure('a@b.in')).resolves.toBeUndefined();
    expect(logger.lines.filter((line) => line.level === 'error').length).toBeGreaterThanOrEqual(3);
  });
});

describe('HibpBreachChecker', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(body: string, ok = true): string[] {
    const urls: string[] = [];
    global.fetch = (async (url: string) => {
      urls.push(String(url));
      return { ok, status: ok ? 200 : 500, text: async () => body };
    }) as unknown as typeof fetch;
    return urls;
  }

  it('sends only the first 5 characters of the hash (the password never leaves the server)', async () => {
    // SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const urls = respondWith('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\nAAAA:2');
    const found = await new HibpBreachChecker(quiet).isBreached('password');
    expect(found).toBe(true);
    expect(urls).toEqual(['https://api.pwnedpasswords.com/range/5BAA6']);
  });

  it('says "not breached" when the hash suffix is not in the list, or only appears as padding (count 0)', async () => {
    respondWith('0000000000000000000000000000000000A:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:0');
    expect(await new HibpBreachChecker(quiet).isBreached('password')).toBe(false);
  });

  it('lets the password through, and logs, when the service is unreachable or errors', async () => {
    const logger = new RecordingLogger();
    global.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await new HibpBreachChecker(logger.asLogger()).isBreached('anything')).toBe(false);
    respondWith('', false);
    expect(await new HibpBreachChecker(logger.asLogger()).isBreached('anything')).toBe(false);
    expect(logger.lines.filter((l) => l.level === 'warn')).toHaveLength(2);
  });
});

describe('account emails', () => {
  it('escapes anything that could become markup, in the HTML version only', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'q'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;',
    );
    const mail = verificationEmail({
      to: 'a@b.in',
      brand: 'Dumbbill',
      name: '<img src=x onerror=alert(1)>',
      link: 'https://app.test/verify?token=a&b=1',
      validHours: 24,
    });
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img');
    expect(mail.html).toContain('token=a&amp;b=1');
  });

  it('carries the link, the expiry and a plain-text version', () => {
    const mail = verificationEmail({
      to: 'a@b.in',
      brand: 'Dumbbill',
      name: 'Ravi',
      link: 'https://app.test/verify?token=abc',
      validHours: 24,
    });
    expect(mail.text).toContain('https://app.test/verify?token=abc');
    expect(mail.text).toContain('24 hours');
    expect(mail.subject).toContain('Dumbbill');
  });
});
