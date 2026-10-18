import { expect, test } from '@playwright/test';
import { scrubBreadcrumb, scrubEvent, stripQueryAndHash } from '@/lib/observability/scrub';

/**
 * Reset and verification links carry a one-time secret in the address. An error report must never carry it to a
 * third-party dashboard, so every address is cut down to its path before it leaves the browser.
 */
test.describe('stripQueryAndHash', () => {
  test('keeps the path and drops the query string and the anchor', () => {
    expect(stripQueryAndHash('/reset-password?token=abc123')).toBe('/reset-password');
    expect(stripQueryAndHash('https://app.dumbbill.in/verify-email?token=abc#top')).toBe(
      'https://app.dumbbill.in/verify-email',
    );
    expect(stripQueryAndHash('/pos#cart')).toBe('/pos');
    expect(stripQueryAndHash('/pos')).toBe('/pos');
  });

  test('leaves values that are not text alone', () => {
    expect(stripQueryAndHash(undefined)).toBeUndefined();
    expect(stripQueryAndHash(42)).toBe(42);
  });
});

test.describe('scrubEvent', () => {
  test('removes cookies, headers, bodies, the user and the secret in the address', () => {
    const event = scrubEvent({
      request: {
        url: 'http://localhost:3001/reset-password?token=SECRET-TOKEN',
        cookies: { dumbbill_csrf: 'x' },
        headers: { authorization: 'Bearer y' },
        data: { password: 'hunter2 hunter2' },
        query_string: 'token=SECRET-TOKEN',
      },
      user: { email: 'ravi@fitfuel.in' },
      transaction: '/verify-email?token=SECRET-TOKEN',
      breadcrumbs: [
        { data: { from: '/login', to: '/reset-password?token=SECRET-TOKEN' } },
        { data: { url: 'http://localhost:3000/v1/auth/reset-password?x=1', status_code: 204 } },
        { message: 'a breadcrumb without data' },
      ],
    });
    expect(event.request).toEqual({ url: 'http://localhost:3001/reset-password' });
    expect(event.user).toBeUndefined();
    expect(event.transaction).toBe('/verify-email');
    expect(JSON.stringify(event)).not.toContain('SECRET-TOKEN');
    expect(event.breadcrumbs?.[1]?.data).toEqual({
      url: 'http://localhost:3000/v1/auth/reset-password',
      status_code: 204,
    });
  });

  test('copes with an event that has no request or breadcrumbs', () => {
    expect(scrubEvent({})).toEqual({ transaction: undefined });
  });
});

test.describe('scrubBreadcrumb', () => {
  test('cuts the addresses a breadcrumb records', () => {
    const crumb = scrubBreadcrumb({
      data: { to: '/reset-password?token=SECRET', other: 'kept?x=1' },
    });
    expect(crumb.data).toEqual({ to: '/reset-password', other: 'kept?x=1' });
  });

  test('copes with a breadcrumb that has no data', () => {
    expect(scrubBreadcrumb({})).toEqual({});
  });
});
