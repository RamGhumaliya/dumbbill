import { expect, test } from '@playwright/test';
import { signIn } from './support/mock-api';

/**
 * Security headers are part of the product: they are checked on real responses, and the page is
 * loaded in a real browser to prove the strict policy does not break the app itself.
 */
test.describe('security headers', () => {
  test('every page carries the standard protective headers', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('the Content-Security-Policy has a fresh nonce on every request and forbids framing', async ({
    request,
  }) => {
    const first = (await request.get('/')).headers()['content-security-policy'] ?? '';
    const second = (await request.get('/')).headers()['content-security-policy'] ?? '';
    const nonce = (policy: string) => policy.match(/'nonce-([^']+)'/)?.[1];

    expect(first).toContain("frame-ancestors 'none'");
    expect(first).toContain("object-src 'none'");
    expect(nonce(first)).toBeTruthy();
    expect(nonce(first)).not.toBe(nonce(second));
  });

  test('USB and serial hardware access is allowed on the POS only', async ({ request }) => {
    expect((await request.get('/pos')).headers()['permissions-policy']).toContain('usb=(self)');
    expect((await request.get('/')).headers()['permissions-policy']).toContain('usb=()');
    expect((await request.get('/admin')).headers()['permissions-policy']).toContain('usb=()');
  });

  test('the strict policy does not break the app: scripts run and no policy violations are reported', async ({
    page,
    context,
  }) => {
    await signIn(page, context); // the till is behind the sign-in gate
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/pos');
    // A button only works if the framework's scripts ran, which proves the nonce was applied to them.
    await page.getByRole('button', { name: /Add Creatine/ }).click();
    await expect(page.getByRole('table')).toBeVisible();

    const policyViolations = problems.filter((text) =>
      /content security policy|refused to/i.test(text),
    );
    expect(policyViolations).toEqual([]);
  });

  test('scripts on the page carry the same nonce as the header', async ({ page }) => {
    const response = await page.goto('/');
    const nonce = (response?.headers()['content-security-policy'] ?? '').match(
      /'nonce-([^']+)'/,
    )?.[1];
    expect(nonce).toBeTruthy();
    // The attribute is hidden from page scripts by the browser (nonce hiding), so read the served HTML.
    const html = await response!.text();
    expect(html).toContain(`nonce="${nonce}"`);
  });
});
