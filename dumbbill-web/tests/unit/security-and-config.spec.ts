import { expect, test } from '@playwright/test';
import { newRequestId } from '@/lib/api/request-id';
import { parseEnv } from '@/lib/env-schema';
import { buildContentSecurityPolicy, buildPermissionsPolicy, originOf } from '@/lib/security/csp';
import { parseThemeChoice, themeAttribute } from '@/lib/theme';

test.describe('Content-Security-Policy', () => {
  const base = { nonce: 'abc123', isDev: false, apiOrigin: 'https://api.dumbbill.in' };

  test('allows scripts only with the request nonce, and never inline or eval in production', () => {
    const csp = buildContentSecurityPolicy(base);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp.match(/script-src[^;]*/)?.[0]).not.toContain('unsafe-inline');
  });

  test('forbids framing, plug-ins, foreign base addresses and foreign form targets', () => {
    const csp = buildContentSecurityPolicy(base);
    for (const rule of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(rule);
    }
  });

  test('lets the browser call the API (and Sentry when configured), nothing else', () => {
    expect(buildContentSecurityPolicy(base)).toContain(
      "connect-src 'self' https://api.dumbbill.in;",
    );
    expect(
      buildContentSecurityPolicy({ ...base, sentryOrigin: 'https://o1.ingest.sentry.io' }),
    ).toContain("connect-src 'self' https://api.dumbbill.in https://o1.ingest.sentry.io;");
  });

  test('production upgrades http links to https; development allows hot reload and eval', () => {
    expect(buildContentSecurityPolicy(base)).toContain('upgrade-insecure-requests');
    const dev = buildContentSecurityPolicy({ ...base, isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev.match(/style-src [^;]*/)?.[0]).toContain("'unsafe-inline'");
    expect(buildContentSecurityPolicy(base).match(/style-src [^;]*/)?.[0]).not.toContain(
      'unsafe-inline',
    );
    expect(dev).toContain('ws:');
    expect(dev).not.toContain('upgrade-insecure-requests');
  });

  test('originOf strips credentials and paths from a Sentry-style address', () => {
    expect(originOf('https://abc123@o1.ingest.sentry.io/5')).toBe('https://o1.ingest.sentry.io');
  });
});

test.describe('Permissions-Policy', () => {
  test('allows USB and serial (printers, scanners) on the POS only', () => {
    expect(buildPermissionsPolicy('/pos')).toContain('usb=(self)');
    expect(buildPermissionsPolicy('/pos/anything')).toContain('serial=(self)');
    expect(buildPermissionsPolicy('/')).toContain('usb=()');
    expect(buildPermissionsPolicy('/admin')).toContain('serial=()');
    expect(buildPermissionsPolicy('/pos-fake')).toContain('usb=()');
  });
});

test.describe('theme choice', () => {
  test('anything unknown means follow the device', () => {
    expect(parseThemeChoice(undefined)).toBe('system');
    expect(parseThemeChoice('purple')).toBe('system');
    expect(parseThemeChoice('<script>')).toBe('system');
  });
  test('dark and light are accepted and map to the data-theme attribute', () => {
    expect(parseThemeChoice('dark')).toBe('dark');
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('system')).toBeUndefined();
  });
});

test.describe('environment settings', () => {
  const valid = {
    NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_VERSION: 'dev',
    NEXT_PUBLIC_SENTRY_DSN: '',
  };

  test('accepts a complete configuration and treats an empty Sentry address as off', () => {
    const env = parseEnv(valid);
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe('http://localhost:3000');
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  test('the design gallery is OFF unless explicitly switched on, so it answers "not found" on the live site', () => {
    expect(parseEnv(valid).NEXT_PUBLIC_DESIGN_GALLERY).toBe(false);
    expect(
      parseEnv({ ...valid, NEXT_PUBLIC_DESIGN_GALLERY: 'false' }).NEXT_PUBLIC_DESIGN_GALLERY,
    ).toBe(false);
    expect(
      parseEnv({ ...valid, NEXT_PUBLIC_DESIGN_GALLERY: 'true' }).NEXT_PUBLIC_DESIGN_GALLERY,
    ).toBe(true);
    expect(() => parseEnv({ ...valid, NEXT_PUBLIC_DESIGN_GALLERY: 'yes' })).toThrow(
      /NEXT_PUBLIC_DESIGN_GALLERY/,
    );
  });

  test('fails with a readable message when a setting is missing or malformed', () => {
    expect(() => parseEnv({ ...valid, NEXT_PUBLIC_API_BASE_URL: 'not a url' })).toThrow(
      /NEXT_PUBLIC_API_BASE_URL/,
    );
    expect(() => parseEnv({ NEXT_PUBLIC_APP_VERSION: 'dev' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});

test.describe('request ids', () => {
  test('are 26 characters, unique and sort by time', () => {
    expect(newRequestId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(new Set(Array.from({ length: 500 }, () => newRequestId())).size).toBe(500);
    expect(newRequestId(2_000_000_000_000) > newRequestId(1_000_000_000_000)).toBe(true);
  });
});
