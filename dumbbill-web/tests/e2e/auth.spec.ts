import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { installMockApi, MockApi, SAMPLE_LOGIN, signIn, WEB_ORIGIN } from './support/mock-api';

/**
 * The account screens as a person meets them, in a real browser against a pretend API (support/mock-api.ts):
 * the sign-in gate, sign in (including two-step and the lockout wait), sign up, confirming the email, forgetting and
 * resetting the password, signing out, and the account-security page.
 *
 * What the real server does (lockouts, token rotation, enumeration safety) is proven by the backend's own tests.
 * Here the question is: does each SCREEN say the right words, send the right request, and go to the right place.
 */

const THEMES = ['dark', 'light'] as const;

/**
 * The control whose label is exactly `label`. Required fields show "Email *" (the star is decoration), so the label
 * is matched as "the words, optionally followed by a star", which also avoids matching "Show password" for "Password".
 */
function field(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByLabel(new RegExp(`^${escaped}\\s*\\*?$`));
}

async function fill(page: Page, label: string, value: string) {
  await field(page, label).fill(value);
}

/**
 * The page's own alerts. Next.js also keeps an invisible `role="alert"` element (the route announcer) on every
 * page, so alerts are looked for inside the main area only.
 */
function alertOf(page: Page) {
  return page.locator('main#main').getByRole('alert');
}

/** The body of the most recent call as an object. */
function bodyOf(api: MockApi, key: string): Record<string, unknown> {
  return (api.last(key)?.body ?? {}) as Record<string, unknown>;
}

test.describe('the sign-in gate', () => {
  test('a visitor with no login is sent to sign in, and no renewal request is wasted on them', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    await page.goto('/pos');
    await expect(page).toHaveURL(/\/login\?next=%2Fpos$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    // No readable CSRF cookie means there cannot be a refresh cookie: no point asking the server.
    expect(api.count('POST /v1/auth/refresh')).toBe(0);
  });

  test('never shows the protected screen while it is still checking the login', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    // Make the check slow, so there is a moment in which the screen must stay hidden.
    api.on('POST /v1/auth/refresh', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return {
        json: { accessToken: 'test-access-token', tokenType: 'Bearer', expiresInSeconds: 900 },
      };
    });
    await page.goto('/');
    await expect(page.getByText('Checking your sign-in')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
  });

  test('a signed-in browser (a refresh cookie exists) goes straight to the screen after a reload', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
    expect(api.count('POST /v1/auth/refresh')).toBe(1);
    // The renewal carries the CSRF proof, and the cookie travels with it.
    expect(api.last('POST /v1/auth/refresh')!.headers['x-csrf-token']).toBe('test-csrf-token');
    // The name is in the top bar.
    await expect(page.getByRole('button', { name: /Account: Ravi Mehta/ })).toBeVisible();
  });

  test('if the login has ended, a visit to the till sends the person to sign in and back again', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('POST /v1/auth/refresh', { problem: 'INVALID_REFRESH_TOKEN' });
    await page.goto('/pos');
    await expect(page).toHaveURL(/\/login\?next=%2Fpos$/);

    // Sign in again: they land on the till, not the home screen.
    api.on('POST /v1/auth/login', { json: SAMPLE_LOGIN });
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Point of sale' })).toBeVisible();
  });
});

test.describe('sign in', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('asks for the email and password before sending anything', async ({ page }) => {
    const api = await installMockApi(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await fill(page, 'Email', 'not-an-email');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/does not look like an email address/)).toBeVisible();
    expect(api.count('POST /v1/auth/login')).toBe(0);
  });

  test('signs in, sends exactly the right request, and shows the dashboard', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', { json: SAMPLE_LOGIN });
    await fill(page, 'Email', '  ravi@fitfuel.in  ');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page).toHaveURL(`${WEB_ORIGIN}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
    // The email is trimmed, the browser kind is WEB (so the refresh token stays in a cookie), and no extra fields.
    expect(bodyOf(api, 'POST /v1/auth/login')).toEqual({
      email: 'ravi@fitfuel.in',
      password: 'violet harbour 4 lantern',
      clientType: 'WEB',
    });
  });

  test('shows ONE generic message for a wrong email or password', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', { problem: 'INVALID_CREDENTIALS' });
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'wrong wrong wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const alert = alertOf(page);
    await expect(alert).toContainText('Cannot sign in');
    await expect(alert).toContainText('The email or password is not correct.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('counts down a lockout and keeps the button disabled until it ends', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', { problem: 'RATE_LIMITED', headers: { 'retry-after': '3' } });
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'wrong wrong wrong');
    const submit = page.getByRole('button', { name: 'Sign in', exact: true });
    await submit.click();
    await expect(alertOf(page)).toContainText(/Wait \d seconds? and try again/);
    await expect(submit).toBeDisabled();
    await expect(submit).toBeEnabled({ timeout: 8000 });
  });

  test('explains an unconfirmed email and can send the link again', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', { problem: 'EMAIL_NOT_VERIFIED' });
    api.on('POST /v1/auth/resend-verification', {
      status: 202,
      json: { message: 'If this email can be used, a message is on its way.' },
    });
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(alertOf(page)).toContainText('Confirm your email first');
    await page.getByRole('button', { name: 'Send the link again' }).click();
    await expect(page.getByRole('status')).toContainText('a new link is on its way');
    expect(bodyOf(api, 'POST /v1/auth/resend-verification')).toEqual({ email: 'ravi@fitfuel.in' });
  });

  test('says the network is the problem when the API cannot be reached', async ({ page }) => {
    await page.route('http://localhost:3000/**', (route) => route.abort());
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(alertOf(page)).toContainText('could not reach the server');
  });

  test('shows a reference to quote on an unexpected server failure', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', { problem: 'INTERNAL_ERROR' });
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(alertOf(page)).toContainText('Something went wrong on our side');
    await expect(alertOf(page)).toContainText('Reference: 01JTESTREQUESTID00000000000');
  });

  test('never follows a "next" address that leaves the site', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', { json: SAMPLE_LOGIN });
    await page.goto('/login?next=https%3A%2F%2Fevil.example%2Fphish');
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
    expect(new URL(page.url()).origin).toBe('http://localhost:3100');
  });

  test('shows the notice from the address after a password reset or sign out, and only known notices', async ({
    page,
  }) => {
    await page.goto('/login?notice=password-reset');
    await expect(page.getByRole('status')).toContainText('Your password was changed');
    await page.goto('/login?notice=signed-out');
    await expect(page.getByRole('status')).toContainText('You are signed out.');
    await page.goto('/login?notice=<script>alert(1)</script>');
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('the password can be shown and hidden', async ({ page }) => {
    const password = field(page, 'Password');
    await password.fill('violet harbour 4 lantern');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });
});

test.describe('two-step sign in', () => {
  async function reachCodeStep(page: Page): Promise<MockApi> {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', (call) => {
      const body = call.body as { totpCode?: string; recoveryCode?: string };
      if (!body.totpCode && !body.recoveryCode) return { problem: 'TOTP_REQUIRED' };
      if (body.totpCode === '123456' || body.recoveryCode === 'K7F2M-9QXPA')
        return { json: SAMPLE_LOGIN };
      return { problem: 'INVALID_TOTP_CODE' };
    });
    await page.goto('/login');
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Enter your two-step code' })).toBeVisible();
    return api;
  }

  test('asks for the code after the password, then signs in with it', async ({ page }) => {
    const api = await reachCodeStep(page);
    await expect(field(page, '6-digit code')).toBeFocused();
    await field(page, '6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
    expect(bodyOf(api, 'POST /v1/auth/login')).toMatchObject({
      totpCode: '123456',
      clientType: 'WEB',
    });
    expect(api.count('POST /v1/auth/login')).toBe(2); // first without a code, then with it
  });

  test('checks the code has 6 digits, and shows a wrong code under the box', async ({ page }) => {
    await reachCodeStep(page);
    await field(page, '6-digit code').fill('12');
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();
    await expect(
      page.getByText('Enter the 6 digits shown in your authenticator app.'),
    ).toBeVisible();
    await field(page, '6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();
    await expect(page.getByText(/not right, or it was already used/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('accepts a recovery code when the phone is lost', async ({ page }) => {
    const api = await reachCodeStep(page);
    await page.getByRole('button', { name: 'Phone lost? Use a recovery code' }).click();
    await field(page, 'Recovery code').fill('K7F2M-9QXPA');
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Owner dashboard' })).toBeVisible();
    expect(bodyOf(api, 'POST /v1/auth/login')).toMatchObject({ recoveryCode: 'K7F2M-9QXPA' });
  });

  test('"Start again" goes back to the email and password', async ({ page }) => {
    await reachCodeStep(page);
    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(field(page, 'Email')).toBeVisible();
  });
});

test.describe('sign up', () => {
  test('checks the fields in the browser, including the 10-character rule, before sending', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter the name of your shop.')).toBeVisible();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await fill(page, 'Password', 'short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Use at least 10 characters.', { exact: true })).toBeVisible();
    expect(api.count('POST /v1/auth/signup')).toBe(0);
  });

  test('says "check your inbox" with the same words for every address (it cannot know who has an account)', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/signup', {
      status: 202,
      json: { message: 'If this email can be used, a message is on its way.' },
    });
    await page.goto('/signup');
    await fill(page, 'Shop or business name', 'FitFuel Nutrition');
    await fill(page, 'Your full name', 'Ravi Mehta');
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Check your inbox')).toBeVisible();
    await expect(page.getByText(/If ravi@fitfuel.in can be used for a new account/)).toBeVisible();
    await expect(page.getByText(/already (registered|used|exists)/i)).toHaveCount(0);
    expect(bodyOf(api, 'POST /v1/auth/signup')).toEqual({
      businessName: 'FitFuel Nutrition',
      ownerName: 'Ravi Mehta',
      email: 'ravi@fitfuel.in',
      password: 'violet harbour 4 lantern',
    });

    await page.getByRole('button', { name: 'Use a different email' }).click();
    await expect(field(page, 'Email')).toHaveValue('');
  });

  test("puts the server's reason for refusing a password under the password box", async ({
    page,
  }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/signup', {
      problem: 'WEAK_PASSWORD',
      problemExtra: {
        detail: 'This password has appeared in a data breach.',
        errors: [
          {
            field: 'password',
            message: 'This password has appeared in a data breach. Please choose a different one.',
          },
        ],
      },
    });
    await page.goto('/signup');
    await fill(page, 'Shop or business name', 'FitFuel Nutrition');
    await fill(page, 'Your full name', 'Ravi Mehta');
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'a long but leaked passphrase');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/appeared in a data breach/)).toBeVisible();
    await expect(field(page, 'Password')).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('confirming the email address', () => {
  test('confirms with the token from the link, once, and offers sign in', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/verify-email', { status: 204 });
    await page.goto('/verify-email?token=tok-123');
    await expect(page.getByText('Email confirmed')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?notice=verified',
    );
    // React runs effects twice in development; the token must only ever be used once.
    expect(api.count('POST /v1/auth/verify-email')).toBe(1);
    expect(bodyOf(api, 'POST /v1/auth/verify-email')).toEqual({ token: 'tok-123' });
  });

  test('an old or used link explains itself and lets the person ask for a new one', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/verify-email', { problem: 'INVALID_TOKEN' });
    api.on('POST /v1/auth/resend-verification', {
      status: 202,
      json: { message: 'If this email can be used, a message is on its way.' },
    });
    await page.goto('/verify-email?token=old-token');
    await expect(page.getByText('This link has expired or was already used')).toBeVisible();
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await page.getByRole('button', { name: 'Send a new link' }).click();
    await expect(page.getByText(/a new link is on its way/)).toBeVisible();
  });

  test('a link without a token says it is incomplete and sends nothing', async ({ page }) => {
    const api = await installMockApi(page);
    await page.goto('/verify-email');
    await expect(page.getByText('This link is incomplete')).toBeVisible();
    expect(api.count('POST /v1/auth/verify-email')).toBe(0);
  });
});

test.describe('forgot and reset password', () => {
  test('forgot password gives the same answer for any address', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/forgot-password', {
      status: 202,
      json: { message: 'If this email can be used, a message is on its way.' },
    });
    await page.goto('/forgot-password');
    await fill(page, 'Email', 'someone@example.com');
    await page.getByRole('button', { name: 'Send the link' }).click();
    await expect(
      page.getByText(/If someone@example.com has an account, a reset link is on its way/),
    ).toBeVisible();
    expect(bodyOf(api, 'POST /v1/auth/forgot-password')).toEqual({ email: 'someone@example.com' });
  });

  test('reset password needs the same password twice, then goes to sign in with a notice', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/reset-password', { status: 204 });
    await page.goto('/reset-password?token=reset-tok');
    await fill(page, 'New password', 'copper window 7 sunrise');
    await fill(page, 'Repeat the new password', 'copper window 7 sunrise!');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('The two passwords are not the same.')).toBeVisible();
    expect(api.count('POST /v1/auth/reset-password')).toBe(0);

    await fill(page, 'Repeat the new password', 'copper window 7 sunrise');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/login\?notice=password-reset$/);
    await expect(page.getByRole('status')).toContainText('Your password was changed');
    expect(bodyOf(api, 'POST /v1/auth/reset-password')).toEqual({
      token: 'reset-tok',
      newPassword: 'copper window 7 sunrise',
    });
  });

  test('an expired link says so and offers a new one; a weak password can be fixed without losing the link', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/reset-password', {
      problem: 'WEAK_PASSWORD',
      problemExtra: {
        errors: [{ field: 'password', message: 'This password is too common or too predictable.' }],
      },
    });
    await page.goto('/reset-password?token=reset-tok');
    await fill(page, 'New password', 'password1234');
    await fill(page, 'Repeat the new password', 'password1234');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('This password is too common or too predictable.')).toBeVisible();
    await expect(field(page, 'New password')).toHaveAttribute('aria-invalid', 'true');

    api.on('POST /v1/auth/reset-password', { problem: 'INVALID_TOKEN' });
    await fill(page, 'New password', 'copper window 7 sunrise');
    await fill(page, 'Repeat the new password', 'copper window 7 sunrise');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('This link has expired or was already used')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Send me a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  test('a reset link without a token says it is incomplete', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText('This link is incomplete')).toBeVisible();
  });
});

test.describe('accepting a team invitation', () => {
  test('the invited person chooses a password, then goes to sign in with a notice', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/accept-invitation', { status: 204 });
    await page.goto('/accept-invitation?token=invite-tok');
    await expect(page.getByRole('heading', { level: 1, name: 'Join your team' })).toBeVisible();
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await fill(page, 'Repeat the new password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page).toHaveURL(/\/login\?notice=invitation-accepted$/);
    await expect(page.getByRole('status')).toContainText('Your account is ready');
    expect(bodyOf(api, 'POST /v1/auth/accept-invitation')).toEqual({
      token: 'invite-tok',
      password: 'violet harbour 4 lantern',
    });
  });

  test('checks the two passwords match before sending anything', async ({ page }) => {
    const api = await installMockApi(page);
    await page.goto('/accept-invitation?token=invite-tok');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await fill(page, 'Repeat the new password', 'something different here');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByText('The two passwords are not the same.')).toBeVisible();
    expect(api.count('POST /v1/auth/accept-invitation')).toBe(0);
  });

  test('a refused password is explained under the box and the link keeps working', async ({
    page,
  }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/accept-invitation', {
      problem: 'WEAK_PASSWORD',
      problemExtra: {
        errors: [{ field: 'password', message: 'This password is too common or too predictable.' }],
      },
    });
    await page.goto('/accept-invitation?token=invite-tok');
    await fill(page, 'Password', 'password1234');
    await fill(page, 'Repeat the new password', 'password1234');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByText('This password is too common or too predictable.')).toBeVisible();
    await expect(page).toHaveURL(/accept-invitation/);
    await expect(page.getByRole('button', { name: 'Create my account' })).toBeEnabled();
  });

  test('an expired or used link says to ask for a new invitation', async ({ page }) => {
    const api = await installMockApi(page);
    api.on('POST /v1/auth/accept-invitation', { problem: 'INVALID_TOKEN' });
    await page.goto('/accept-invitation?token=old-tok');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await fill(page, 'Repeat the new password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByText('This invitation has expired or was already used')).toBeVisible();
    await expect(page.getByText(/Ask the person who invited you/)).toBeVisible();
  });

  test('a link without a token says it is incomplete and sends nothing', async ({ page }) => {
    const api = await installMockApi(page);
    await page.goto('/accept-invitation');
    await expect(page.getByText('This link is incomplete')).toBeVisible();
    expect(api.count('POST /v1/auth/accept-invitation')).toBe(0);
  });
});

test.describe('signing out', () => {
  test('ends the session on the server with the CSRF proof, clears the screen, and the till bill with it', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    await page.goto('/pos');
    await page.getByRole('button', { name: /Add Gold Standard Whey/ }).click(); // a half-built bill
    await expect(page.getByRole('table')).toBeVisible();

    await page.getByRole('button', { name: /Account: Ravi Mehta/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
    await expect(page.getByRole('status')).toContainText('You are signed out.');
    expect(api.last('POST /v1/auth/logout')!.headers['x-csrf-token']).toBe('test-csrf-token');

    // The next person at this computer must not find the previous bill: sign in again and open the till.
    api.on('POST /v1/auth/login', { json: SAMPLE_LOGIN });
    await fill(page, 'Email', 'someone.else@fitfuel.in');
    await fill(page, 'Password', 'violet harbour 4 lantern');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Point of sale' }).click();
    await expect(page.getByText('Nothing in the bill yet.')).toBeVisible();
  });
});

test.describe('account security', () => {
  test('lists the devices, marks this one, and signs another out', async ({ page, context }) => {
    const api = await signIn(page, context);
    let others = [
      {
        id: 'sess-2',
        deviceLabel: 'Chrome on Windows',
        clientType: 'WEB',
        ipAddress: '103.21.58.14',
        createdAt: '2026-10-17T09:30:00.000Z',
        lastUsedAt: '2026-10-18T11:05:00.000Z',
        current: false,
      },
    ];
    api.on('GET /v1/auth/sessions', () => ({
      json: {
        sessions: [
          {
            id: 'sess-1',
            deviceLabel: 'Safari on iOS',
            clientType: 'WEB',
            ipAddress: '49.36.1.2',
            createdAt: '2026-10-18T09:00:00.000Z',
            lastUsedAt: '2026-10-18T12:00:00.000Z',
            current: true,
          },
          ...others,
        ],
      },
    }));
    api.on('DELETE /v1/auth/sessions/sess-2', () => {
      others = [];
      return { status: 204 };
    });

    await page.goto('/account/security');
    await expect(page.getByRole('heading', { level: 1, name: 'Account security' })).toBeVisible();
    const list = page.getByRole('list').filter({ hasText: 'Safari on iOS' });
    await expect(list.getByText('This device')).toBeVisible();
    await expect(list.getByText('Chrome on Windows')).toBeVisible();
    await expect(list.getByText(/18 Oct 2026/).first()).toBeVisible();
    // The device in use cannot be signed out from here.
    await expect(page.getByRole('button', { name: 'Sign out Safari on iOS' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out Chrome on Windows' }).click();
    await expect(page.getByText('Device signed out', { exact: true })).toBeVisible();
    await expect(page.getByText('Chrome on Windows')).toHaveCount(0);
    expect(api.count('DELETE /v1/auth/sessions/sess-2')).toBe(1);
  });

  test('changes the password, and puts a wrong current password under its own box', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/auth/sessions', { json: { sessions: [] } });
    api.on('POST /v1/auth/change-password', (call) =>
      (call.body as { currentPassword: string }).currentPassword === 'right password here'
        ? { status: 204 }
        : { problem: 'INVALID_CREDENTIALS' },
    );
    await page.goto('/account/security');
    await fill(page, 'Current password', 'wrong password');
    await fill(page, 'New password', 'copper window 7 sunrise');
    await fill(page, 'Repeat the new password', 'copper window 7 sunrise');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('That is not your current password.')).toBeVisible();

    await fill(page, 'Current password', 'right password here');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(
      page.getByRole('region', { name: /Notifications/ }).getByText('Password changed'),
    ).toBeVisible();
    await expect(field(page, 'Current password')).toHaveValue('');
    expect(bodyOf(api, 'POST /v1/auth/change-password')).toEqual({
      currentPassword: 'right password here',
      newPassword: 'copper window 7 sunrise',
    });
  });

  test('sets up two-step sign-in: QR code and key, password, first code, recovery codes shown once, then it is on', async ({
    page,
    context,
  }) => {
    const api = await signIn(page, context);
    api.on('GET /v1/auth/sessions', { json: { sessions: [] } });
    api.on('POST /v1/auth/totp/setup', {
      json: {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpAuthUri:
          'otpauth://totp/Dumbbill:ravi%40fitfuel.in?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Dumbbill',
      },
    });
    api.on('POST /v1/auth/totp/enable', (call) => {
      const body = call.body as { code: string; currentPassword: string };
      if (body.currentPassword !== 'Right-password-1!') return { problem: 'INVALID_CREDENTIALS' };
      return body.code === '123456'
        ? {
            json: {
              recoveryCodes: [
                'K7F2M-9QXPA',
                'H4T8N-2WZCD',
                'P3R6K-7MBQE',
                'W9D2F-4XNTA',
                'C5J8H-6QVLR',
                'Z2M7B-3KGYD',
                'T6N4X-8PFHS',
                'A8Q3V-5RWJC',
              ],
            },
          }
        : { problem: 'INVALID_TOTP_CODE' };
    });

    await page.goto('/account/security');
    await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
    await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();
    // The QR code is drawn in the page (no image is fetched from anywhere) and has real squares in it.
    const qr = page.getByRole('img', { name: 'QR code for your authenticator app' });
    await expect(qr).toBeVisible();
    expect((await qr.locator('path').getAttribute('d'))?.length ?? 0).toBeGreaterThan(200);

    // Without the password nothing is sent to switch it on.
    await field(page, '6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Switch on' }).click();
    await expect(page.getByText(/Enter your password|password/i).first()).toBeVisible();
    expect(api.count('POST /v1/auth/totp/enable')).toBe(0);

    await field(page, 'Your password').fill('Wrong-password-1!');
    await page.getByRole('button', { name: 'Switch on' }).click();
    await expect(page.getByText('That is not your current password.')).toBeVisible();

    await field(page, 'Your password').fill('Right-password-1!');
    await field(page, '6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Switch on' }).click();
    await expect(
      page.getByText(/not right, or it was already used|not right/).first(),
    ).toBeVisible();

    await field(page, '6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Switch on' }).click();
    await expect(page.getByText('Save your recovery codes')).toBeVisible();
    expect(api.last('POST /v1/auth/totp/enable')?.body).toEqual({
      code: '123456',
      currentPassword: 'Right-password-1!',
    });
    await expect(page.getByText('K7F2M-9QXPA')).toBeVisible();

    await page.getByRole('button', { name: 'I have saved them' }).click();
    await expect(page.getByText(/Two-step sign-in is on/)).toBeVisible();
    // The recovery codes are gone from the page for good.
    await expect(page.getByText('K7F2M-9QXPA')).toHaveCount(0);
    // And the account menu now knows two-step is on (no reload needed).
    await expect(page.getByRole('button', { name: 'Switch off' })).toBeVisible();
  });
});

test.describe('the strict security policy', () => {
  test('the sign-in page runs under the Content-Security-Policy without violations', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await installMockApi(page);
    await page.goto('/login');
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await page.getByRole('button', { name: 'Show password' }).click(); // proves scripts ran
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible();
    expect(problems.filter((text) => /Content Security Policy|CSP|violat/i.test(text))).toEqual([]);
  });
});

/** Every account screen, in both themes, must pass the automatic accessibility check. */
const SCREENS = [
  { name: 'sign in', path: '/login', heading: 'Sign in' },
  { name: 'sign up', path: '/signup', heading: 'Create your shop account' },
  { name: 'forgot password', path: '/forgot-password', heading: 'Reset your password' },
  { name: 'reset password', path: '/reset-password?token=t', heading: 'Choose a new password' },
  { name: 'confirm email (failed link)', path: '/verify-email', heading: 'Confirm your email' },
  { name: 'accept invitation', path: '/accept-invitation?token=t', heading: 'Join your team' },
] as const;

for (const theme of THEMES) {
  for (const screen of SCREENS) {
    test(`${screen.name} is accessible in the ${theme} theme`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'dumbbill-theme', value: theme, url: baseURL! }]);
      await installMockApi(page);
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible();
      await page.screenshot({
        path: `test-results/screens/auth-${screen.name.replace(/[^a-z]+/g, '-')}-${theme}.png`,
        fullPage: true,
      });

      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const serious = result.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        serious.map(
          (v) =>
            `${v.id}: ${v.help} -> ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }

  test(`the form with errors showing is accessible in the ${theme} theme`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'dumbbill-theme', value: theme, url: baseURL! }]);
    const api = await installMockApi(page);
    api.on('POST /v1/auth/login', { problem: 'INVALID_CREDENTIALS' });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); // field errors
    await fill(page, 'Email', 'ravi@fitfuel.in');
    await fill(page, 'Password', 'wrong wrong wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); // alert
    await expect(alertOf(page)).toBeVisible();
    await page.screenshot({
      path: `test-results/screens/auth-sign-in-error-${theme}.png`,
      fullPage: true,
    });
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => v.id),
    ).toEqual([]);
  });

  test(`account security is accessible in the ${theme} theme`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'dumbbill-theme', value: theme, url: baseURL! }]);
    const api = await signIn(page, context);
    api.on('GET /v1/auth/sessions', {
      json: {
        sessions: [
          {
            id: 's1',
            deviceLabel: 'Chrome on Windows',
            clientType: 'WEB',
            ipAddress: '103.21.58.14',
            createdAt: '2026-10-18T09:00:00.000Z',
            lastUsedAt: '2026-10-18T12:00:00.000Z',
            current: true,
          },
          {
            id: 's2',
            deviceLabel: 'Dumbbill app on Android',
            clientType: 'MOBILE',
            ipAddress: '49.36.1.2',
            createdAt: '2026-10-10T09:00:00.000Z',
            lastUsedAt: '2026-10-17T12:00:00.000Z',
            current: false,
          },
        ],
      },
    });
    await page.goto('/account/security');
    await expect(page.getByText('Dumbbill app on Android')).toBeVisible();
    await page.screenshot({
      path: `test-results/screens/auth-account-security-${theme}.png`,
      fullPage: true,
    });
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help}`),
    ).toEqual([]);
  });
}
