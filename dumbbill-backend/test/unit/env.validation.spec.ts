import { validateEnv } from '../../src/config/env.validation';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
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
      /NODE_ENV[\s\S]*PORT[\s\S]*DATABASE_URL[\s\S]*REDIS_URL/,
    );
  });
});
