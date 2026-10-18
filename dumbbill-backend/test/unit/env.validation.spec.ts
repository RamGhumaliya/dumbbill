import { validateEnv } from '../../src/config/env.validation';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  APP_DATABASE_URL: 'postgresql://app:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.BRAND_NAME).toBe('Dumbbill');
  });

  it('fails fast and lists every invalid variable', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging', PORT: '0' })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*APP_DATABASE_URL[\s\S]*REDIS_URL/,
    );
  });

  describe('sign-in and security settings', () => {
    it('applies safe development defaults', () => {
      const env = validateEnv(valid);
      expect(env.WEB_BASE_URL).toBe('http://localhost:3001');
      expect(env.TRUST_PROXY_HOPS).toBe(0);
      expect(env.ARGON2_MEMORY_KIB).toBe(65536);
      expect(env.ARGON2_TIME_COST).toBe(3);
      expect(env.PASSWORD_BREACH_CHECK).toBe(true);
      expect(env.RATE_LIMIT_DISABLED).toBe(false);
    });

    it('reads the text "false" as false (a plain text-to-boolean conversion would say true)', () => {
      expect(validateEnv({ ...valid, PASSWORD_BREACH_CHECK: 'false' }).PASSWORD_BREACH_CHECK).toBe(
        false,
      );
      expect(validateEnv({ ...valid, PASSWORD_BREACH_CHECK: 'true' }).PASSWORD_BREACH_CHECK).toBe(
        true,
      );
    });
  });

  describe('production refuses development shortcuts', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      JWT_PRIVATE_KEY: 'a2V5',
      JWT_KEY_ID: 'prod-2026-10',
      DATA_ENCRYPTION_KEY: 'a2V5',
      PASSWORD_PEPPERS: `1:${'x'.repeat(40)}`,
      WEB_BASE_URL: 'https://app.dumbbill.in',
      CORS_ALLOWED_ORIGINS: 'https://app.dumbbill.in',
    };

    it('accepts a complete production configuration', () => {
      expect(() => validateEnv(production)).not.toThrow();
    });

    it('lists every missing secret at once', () => {
      expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
        /JWT_PRIVATE_KEY[\s\S]*JWT_KEY_ID[\s\S]*DATA_ENCRYPTION_KEY[\s\S]*PASSWORD_PEPPERS[\s\S]*WEB_BASE_URL/,
      );
    });

    it.each([
      ['a short pepper', { PASSWORD_PEPPERS: '1:tooshort' }, /PASSWORD_PEPPERS entries/],
      [
        'a pepper without a version',
        { PASSWORD_PEPPERS: 'x'.repeat(40) },
        /PASSWORD_PEPPERS entries/,
      ],
      ['the development key id', { JWT_KEY_ID: 'dev' }, /JWT_KEY_ID/],
      ['weak password hashing', { ARGON2_MEMORY_KIB: '4096' }, /ARGON2_MEMORY_KIB/],
      ['a web address without https', { WEB_BASE_URL: 'http://app.dumbbill.in' }, /https/],
      ['a wildcard CORS origin', { CORS_ALLOWED_ORIGINS: '*' }, /never "\*"/],
    ])('rejects %s', (_name, change, message) => {
      expect(() => validateEnv({ ...production, ...change })).toThrow(message);
    });

    it('refuses the development switch that turns rate limits off', () => {
      expect(() => validateEnv({ ...production, RATE_LIMIT_DISABLED: 'true' })).toThrow(
        /RATE_LIMIT_DISABLED/,
      );
      expect(() => validateEnv({ ...production, RATE_LIMIT_DISABLED: 'false' })).not.toThrow();
    });

    it('allows the same shortcuts in development and tests', () => {
      expect(() => validateEnv({ ...valid, NODE_ENV: 'development' })).not.toThrow();
      expect(() =>
        validateEnv({ ...valid, NODE_ENV: 'test', ARGON2_MEMORY_KIB: '8' }),
      ).not.toThrow();
    });
  });
});
