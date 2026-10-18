import { describeDevice } from '../../src/modules/auth/domain/device-label';
import {
  FREE_ATTEMPTS,
  lockSecondsForFailures,
  MAX_LOCK_SECONDS,
} from '../../src/modules/auth/domain/lockout';
import {
  formatToken,
  generateSecret,
  hashSecret,
  parseToken,
} from '../../src/modules/auth/domain/opaque-token';
import {
  checkPasswordPolicy,
  PASSWORD_MAX_LENGTH,
} from '../../src/modules/auth/domain/password-policy';
import { uuid7 } from '../../src/common/uuid7';

const TENANT = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';

describe('opaque tokens', () => {
  it('a token carries the business id and a long random secret, and parses back', () => {
    const secret = generateSecret();
    expect(secret).toHaveLength(43); // 32 bytes in URL-safe base64
    const parsed = parseToken(formatToken(TENANT, secret));
    expect(parsed).toEqual({ tenantId: TENANT, secret });
  });

  it('two secrets are never the same', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });

  it('only a one-way hash is stored: it differs from the secret and is stable', () => {
    const secret = generateSecret();
    expect(hashSecret(secret)).not.toContain(secret);
    expect(hashSecret(secret)).toBe(hashSecret(secret));
    expect(hashSecret(secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses anything that is not shaped like our tokens', () => {
    for (const bad of [
      '',
      'abc',
      'not-a-uuid.' + generateSecret(),
      `${TENANT}.short`,
      `${TENANT}.${'a'.repeat(300)}`,
      `${TENANT}`,
      42,
      null,
      undefined,
      { token: 1 },
    ]) {
      expect(parseToken(bad)).toBeNull();
    }
  });

  it('refuses to build a token for an id that is not a UUID', () => {
    expect(() => formatToken("x'; DROP TABLE users;--", generateSecret())).toThrow();
  });
});

describe('password policy', () => {
  const good = 'violet harbour 4 lantern';

  it('accepts a long passphrase without needing symbols or capitals', () => {
    expect(checkPasswordPolicy(good)).toEqual([]);
  });

  it('rejects short passwords and says how long they must be', () => {
    const problems = checkPasswordPolicy('short1');
    expect(problems.map((p) => p.message).join(' ')).toMatch(/at least 10 characters/);
    expect(problems[0]?.field).toBe('password');
  });

  it('rejects absurdly long passwords (so nobody can make the server hash a huge string)', () => {
    expect(checkPasswordPolicy('a1b2'.repeat(PASSWORD_MAX_LENGTH))).not.toEqual([]);
  });

  it('rejects common passwords whatever their case', () => {
    expect(checkPasswordPolicy('Password123')).not.toEqual([]);
    expect(checkPasswordPolicy('QWERTYUIOP')).not.toEqual([]);
    expect(checkPasswordPolicy('1234567890')).not.toEqual([]);
  });

  it('rejects trivial patterns: repeats and simple runs', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaa')).not.toEqual([]);
    expect(checkPasswordPolicy('abcdefghijkl')).not.toEqual([]);
    expect(checkPasswordPolicy('zyxwvutsrqpo')).not.toEqual([]);
  });

  it("rejects passwords built from the person's own details or the product name", () => {
    const context = {
      email: 'ravi.mehta@fitfuel.in',
      fullName: 'Ravi Mehta',
      businessName: 'FitFuel Nutrition',
      brandName: 'Dumbbill',
    };
    expect(checkPasswordPolicy('ravi.mehta@fitfuel.in', context)).not.toEqual([]);
    expect(checkPasswordPolicy('ravi.mehta-2026!', context)).not.toEqual([]);
    expect(checkPasswordPolicy('ilovefitfuelnutrition', context)).not.toEqual([]);
    expect(checkPasswordPolicy('my dumbbill secret 99', context)).not.toEqual([]);
    expect(checkPasswordPolicy(good, context)).toEqual([]);
  });
});

describe('lockout schedule', () => {
  it('the first 4 wrong attempts are free', () => {
    for (let n = 0; n <= FREE_ATTEMPTS; n++) expect(lockSecondsForFailures(n)).toBe(0);
  });

  it('from the 5th failure the lock doubles each time, up to 15 minutes', () => {
    expect([5, 6, 7, 8, 9, 10, 50].map(lockSecondsForFailures)).toEqual([
      60, 120, 240, 480, 900, 900, 900,
    ]);
    expect(lockSecondsForFailures(1000)).toBe(MAX_LOCK_SECONDS);
  });
});

describe('device labels', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'WEB',
      'Chrome on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
      'WEB',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'WEB',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      'WEB',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/127.0',
      'WEB',
      'Firefox on macOS',
    ],
    ['Dart/3.14 (dart:io)', 'MOBILE', 'Dumbbill app'],
    [undefined, 'MOBILE', 'Mobile app'],
    [undefined, 'WEB', 'Unknown browser'],
  ])('%s -> %s', (agent, client, label) => {
    expect(describeDevice(agent as string | undefined, client as string)).toBe(label);
  });
});

describe('uuid7', () => {
  it('has the version 7 and variant bits, so it is a valid UUID', () => {
    expect(uuid7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('starts with the time, so ids sort in creation order', () => {
    const earlier = uuid7(1_700_000_000_000);
    const later = uuid7(1_700_000_001_000);
    expect(later > earlier).toBe(true);
    expect(earlier.replace('-', '').slice(0, 12)).toBe(
      (1_700_000_000_000).toString(16).padStart(12, '0'),
    );
  });

  it('is unique in a tight loop', () => {
    expect(new Set(Array.from({ length: 2000 }, () => uuid7())).size).toBe(2000);
  });
});
