import { expect, test } from '@playwright/test';
import { z } from 'zod';
import {
  clearAccessToken,
  createTokenRefresher,
  getAccessToken,
  notifySignedOut,
  readCsrfToken,
  setAccessToken,
} from '@/lib/api/auth';
import { createApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import * as authApi from '@/lib/api/endpoints/auth';
import { formatDateTime } from '@/lib/format/datetime';
import { applyApiErrors } from '@/lib/forms/apply-api-errors';
import { safeNextPath } from '@/lib/auth/redirect';
import { useSession } from '@/stores/session';

/**
 * The sign-in plumbing of the web app, tested with a fake `fetch` so no server is needed: where a person is sent
 * after signing in (must not be an open redirect), how the login is renewed with the refresh cookie and the CSRF
 * header, what an API failure looks like to a screen, and the signed-in/signed-out state the screens read.
 */
const BASE = 'http://api.test';

type Call = { url: URL; init: RequestInit };

/** A fake fetch that answers from a queue and records every call. */
function fakeFetch(...answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (input: URL | string, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    const next = answers.shift();
    if (!next) throw new Error('fakeFetch ran out of answers');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const problem = (code: string, status: number, headers: Record<string, string> = {}, extra = {}) =>
  json(
    {
      type: 'https://api.dumbbill.in/errors/x',
      title: 'T',
      status,
      code,
      requestId: 'REQ1',
      ...extra,
    },
    status,
    { 'content-type': 'application/problem+json', ...headers },
  );

const headerOf = (call: Call | undefined, name: string) =>
  (call?.init.headers as Record<string, string> | undefined)?.[name];

test.describe('safeNextPath (no open redirects)', () => {
  test('keeps ordinary pages of this site, with their query and anchor', () => {
    expect(safeNextPath('/pos')).toBe('/pos');
    expect(safeNextPath('/account/security')).toBe('/account/security');
    expect(safeNextPath('/products?category=whey&page=2#top')).toBe(
      '/products?category=whey&page=2#top',
    );
  });

  test('falls back to the home screen for anything that leaves the site', () => {
    for (const bad of [
      'https://evil.example',
      'http://evil.example/login',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '   /pos',
      '/pos\nSet-Cookie: x=1',
      '/pos\u0000',
    ]) {
      expect(safeNextPath(bad)).toBe('/');
    }
  });

  test('falls back for empty, missing and absurdly long values', () => {
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath(`/${'a'.repeat(400)}`)).toBe('/');
  });

  test('never sends a freshly signed-in person back to a sign-in page (no loops)', () => {
    for (const page of [
      '/login',
      '/login?next=/pos',
      '/signup',
      '/verify-email?token=x',
      '/forgot-password',
      '/reset-password',
    ]) {
      expect(safeNextPath(page)).toBe('/');
    }
    // A page that merely starts with the same letters is fine.
    expect(safeNextPath('/loginhistory')).toBe('/loginhistory');
  });

  test('uses the fallback it is given', () => {
    expect(safeNextPath('https://evil.example', '/dashboard')).toBe('/dashboard');
  });
});

test.describe('readCsrfToken', () => {
  test('finds the cookie among others', () => {
    expect(readCsrfToken('a=1; dumbbill_csrf=abc-123_x; b=2')).toBe('abc-123_x');
  });

  test('keeps "=" characters inside the value', () => {
    expect(readCsrfToken('dumbbill_csrf=ab==')).toBe('ab==');
  });

  test('is null when the cookie is missing or empty, and does not match look-alike names', () => {
    expect(readCsrfToken('')).toBeNull();
    expect(readCsrfToken('a=1; b=2')).toBeNull();
    expect(readCsrfToken('dumbbill_csrf=')).toBeNull();
    expect(readCsrfToken('x_dumbbill_csrf=nope; dumbbill_csrf_old=nope')).toBeNull();
  });
});

test.describe('renewing the login with the refresh cookie', () => {
  const answer = { accessToken: 'new-access-token', tokenType: 'Bearer', expiresInSeconds: 900 };

  test.beforeEach(() => clearAccessToken());

  test('without the CSRF cookie there is no session: false, and no request is made', async () => {
    const { impl, calls } = fakeFetch();
    const refresh = createTokenRefresher({
      baseUrl: BASE,
      fetchImpl: impl,
      getCsrfToken: () => null,
    });
    expect(await refresh()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('sends the cookie and the CSRF header, then keeps the new access token in memory', async () => {
    const { impl, calls } = fakeFetch(json(answer));
    const refresh = createTokenRefresher({
      baseUrl: BASE,
      fetchImpl: impl,
      getCsrfToken: () => 'csrf-1',
    });
    expect(await refresh()).toBe(true);

    expect(calls[0]!.url.href).toBe('http://api.test/v1/auth/refresh');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('include'); // the httpOnly refresh cookie travels with it
    expect(headerOf(calls[0], 'X-CSRF-Token')).toBe('csrf-1');
    expect(getAccessToken()).toBe('new-access-token');
  });

  test('answers false, and keeps no token, for every kind of failure', async () => {
    const failures: Array<Response | Error> = [
      problem('INVALID_REFRESH_TOKEN', 401),
      problem('CSRF_FAILED', 403),
      new Response('Bad gateway', { status: 502 }),
      json({ unexpected: 'shape' }),
      new Error('network down'),
    ];
    for (const failure of failures) {
      clearAccessToken();
      const { impl } = fakeFetch(failure);
      const refresh = createTokenRefresher({
        baseUrl: BASE,
        fetchImpl: impl,
        getCsrfToken: () => 'csrf',
      });
      expect(await refresh()).toBe(false);
      expect(getAccessToken()).toBeNull();
    }
  });

  test('calls made at the same moment share one request', async () => {
    const { impl, calls } = fakeFetch(json(answer));
    const refresh = createTokenRefresher({
      baseUrl: BASE,
      fetchImpl: impl,
      getCsrfToken: () => 'csrf',
    });
    const results = await Promise.all([refresh(), refresh(), refresh()]);
    expect(results).toEqual([true, true, true]);
    expect(calls).toHaveLength(1);
  });

  test('can be used again after finishing (a later renewal makes a new request)', async () => {
    const { impl, calls } = fakeFetch(json(answer), json({ ...answer, accessToken: 'second' }));
    const refresh = createTokenRefresher({
      baseUrl: BASE,
      fetchImpl: impl,
      getCsrfToken: () => 'csrf',
    });
    await refresh();
    await refresh();
    expect(calls).toHaveLength(2);
    expect(getAccessToken()).toBe('second');
  });
});

test.describe('the API client with cookies', () => {
  test('passes the cookie setting to fetch and extra headers to the request', async () => {
    const { impl, calls } = fakeFetch(json({ ok: 'yes' }));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl, credentials: 'include' });
    await client.request({
      path: '/x',
      schema: z.object({ ok: z.string() }),
      headers: { 'X-CSRF-Token': 't' },
    });
    expect(calls[0]!.init.credentials).toBe('include');
    expect(headerOf(calls[0], 'X-CSRF-Token')).toBe('t');
  });

  test('carries the Retry-After header on a rate-limit error, so the screen can count down', async () => {
    const { impl } = fakeFetch(problem('RATE_LIMITED', 429, { 'retry-after': '60' }));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    const error = await client
      .request({ path: '/x', schema: z.unknown() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('RATE_LIMITED');
    expect((error as ApiError).retryAfterSeconds).toBe(60);
  });

  test('has no retry time when the header is missing or not a number', async () => {
    const headerCases: Array<Record<string, string>> = [
      {},
      { 'retry-after': 'soon' },
      { 'retry-after': '0' },
    ];
    for (const header of headerCases) {
      const { impl } = fakeFetch(problem('RATE_LIMITED', 429, header));
      const error = await createApiClient({ baseUrl: BASE, fetchImpl: impl })
        .request({ path: '/x', schema: z.unknown() })
        .catch((e: unknown) => e);
      expect((error as ApiError).retryAfterSeconds).toBeUndefined();
    }
  });
});

test.describe('auth endpoints', () => {
  const user = {
    id: 'u1',
    email: 'ravi@fitfuel.in',
    fullName: 'Ravi Mehta',
    isOwner: true,
    totpEnabled: false,
  };
  const tenant = {
    id: 't1',
    name: 'FitFuel Nutrition',
    status: 'TRIAL',
    trialEndsAt: '2026-11-01T09:30:00.000Z',
  };
  const access = {
    roleName: 'Owner',
    permissions: ['team.manage'],
    discountLimitBp: 10000,
    allBranches: true,
    branchIds: [],
  };
  const login = {
    accessToken: 'a',
    tokenType: 'Bearer',
    expiresInSeconds: 900,
    user,
    tenant,
    access,
  };

  test('logIn always asks for the browser kind, so the refresh token arrives as a cookie and not in JSON', async () => {
    const { impl, calls } = fakeFetch(json(login));
    const result = await authApi.logIn(createApiClient({ baseUrl: BASE, fetchImpl: impl }), {
      email: 'ravi@fitfuel.in',
      password: 'a long passphrase here',
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      email: 'ravi@fitfuel.in',
      password: 'a long passphrase here',
      clientType: 'WEB',
    });
    expect(calls[0]!.url.pathname).toBe('/v1/auth/login');
    expect(result.user.fullName).toBe('Ravi Mehta');
    expect(headerOf(calls[0], 'Authorization')).toBeUndefined(); // public: no stale token attached
  });

  test('logIn passes the two-step code or a recovery code when given', async () => {
    const { impl, calls } = fakeFetch(json(login), json(login));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    await authApi.logIn(client, { email: 'a@b.in', password: 'x', totpCode: '123456' });
    await authApi.logIn(client, { email: 'a@b.in', password: 'x', recoveryCode: 'K7F2M-9QXPA' });
    expect(JSON.parse(String(calls[0]!.init.body)).totpCode).toBe('123456');
    expect(JSON.parse(String(calls[1]!.init.body)).recoveryCode).toBe('K7F2M-9QXPA');
  });

  test('a sign-in answer in the wrong shape is reported, not passed on', async () => {
    const { impl } = fakeFetch(json({ accessToken: 'a' }));
    const error = await authApi
      .logIn(createApiClient({ baseUrl: BASE, fetchImpl: impl }), {
        email: 'a@b.in',
        password: 'x',
      })
      .catch((e: unknown) => e);
    expect((error as ApiError).code).toBe('INVALID_RESPONSE');
  });

  test('endpoints that answer 204 resolve with nothing', async () => {
    const { impl } = fakeFetch(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    );
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    await expect(authApi.verifyEmail(client, 'tok')).resolves.toBeUndefined();
    await expect(
      authApi.resetPassword(client, { token: 't', newPassword: 'p' }),
    ).resolves.toBeUndefined();
    await expect(authApi.logOut(client, 'csrf')).resolves.toBeUndefined();
  });

  test('logOut sends the CSRF header; the signed-in calls send the bearer token', async () => {
    setAccessToken('my-access-token');
    const { impl, calls } = fakeFetch(
      new Response(null, { status: 204 }),
      json({ user, tenant, access }),
      json({ sessions: [] }),
    );
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl, getAccessToken });
    await authApi.logOut(client, 'csrf-9');
    await authApi.getCurrentUser(client);
    await authApi.listSessions(client);
    expect(headerOf(calls[0], 'X-CSRF-Token')).toBe('csrf-9');
    expect(headerOf(calls[0], 'Authorization')).toBeUndefined(); // logout is authenticated by the cookie
    expect(headerOf(calls[1], 'Authorization')).toBe('Bearer my-access-token');
    expect(headerOf(calls[2], 'Authorization')).toBe('Bearer my-access-token');
    clearAccessToken();
  });

  test('acceptInvitation posts the token and the chosen password, without a login', async () => {
    const { impl, calls } = fakeFetch(new Response(null, { status: 204 }));
    await authApi.acceptInvitation(createApiClient({ baseUrl: BASE, fetchImpl: impl }), {
      token: 'invite-token',
      password: 'violet harbour 4 lantern',
    });
    expect(calls[0]!.url.pathname).toBe('/v1/auth/accept-invitation');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      token: 'invite-token',
      password: 'violet harbour 4 lantern',
    });
    expect(headerOf(calls[0], 'Authorization')).toBeUndefined();
  });

  test('revokeSession escapes the id it puts in the address', async () => {
    const { impl, calls } = fakeFetch(new Response(null, { status: 204 }));
    await authApi.revokeSession(createApiClient({ baseUrl: BASE, fetchImpl: impl }), '../x?y=1');
    expect(calls[0]!.url.pathname).toBe('/v1/auth/sessions/..%2Fx%3Fy%3D1');
    expect(calls[0]!.init.method).toBe('DELETE');
  });
});

test.describe('the signed-in state the screens read', () => {
  const user = { id: 'u1', email: 'a@b.in', fullName: 'A B', isOwner: true, totpEnabled: false };
  const tenant = { id: 't1', name: 'Shop', status: 'TRIAL' as const, trialEndsAt: null };
  const access = {
    roleName: 'Owner',
    permissions: ['team.manage'],
    discountLimitBp: 10000,
    allBranches: true,
    branchIds: [],
  };

  test.beforeEach(() => {
    useSession.setState({
      status: 'restoring',
      user: null,
      tenant: null,
      access: null,
      choseToSignOut: false,
    });
  });

  test('starts as "restoring", becomes signed in, and can learn that two-step sign-in was switched on', () => {
    expect(useSession.getState().status).toBe('restoring');
    useSession.getState().setSignedIn(user, tenant, access);
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', user: { fullName: 'A B' } });
    useSession.getState().updateUser({ totpEnabled: true });
    expect(useSession.getState().user?.totpEnabled).toBe(true);
  });

  test('when the API finds the login dead, the screens are told and the access token is forgotten', () => {
    setAccessToken('token');
    useSession.getState().setSignedIn(user, tenant, access);
    notifySignedOut();
    expect(getAccessToken()).toBeNull();
    expect(useSession.getState()).toMatchObject({
      status: 'signedOut',
      user: null,
      tenant: null,
      choseToSignOut: false,
    });
  });

  test('remembers when the person chose to sign out, and forgets it at the next sign-in', () => {
    useSession.getState().setSignedOut(true);
    expect(useSession.getState().choseToSignOut).toBe(true);
    useSession.getState().setSignedIn(user, tenant, access);
    expect(useSession.getState().choseToSignOut).toBe(false);
  });

  test('updateUser does nothing when nobody is signed in', () => {
    useSession.getState().updateUser({ totpEnabled: true });
    expect(useSession.getState().user).toBeNull();
  });
});

test.describe('showing server field errors', () => {
  test("a refused password lands under the password field, renamed to the form's own field name", () => {
    const calls: Array<[string, { message?: string }]> = [];
    const error = new ApiError(
      422,
      'WEAK_PASSWORD',
      'Choose a stronger password',
      'R',
      'Use at least 10 characters.',
      [{ field: 'password', message: 'Use at least 10 characters.' }],
    );
    const handled = applyApiErrors(
      error,
      ((name: string, e: { message?: string }) => calls.push([name, e])) as never,
      { password: 'newPassword' },
    );
    expect(handled).toBe(true);
    expect(calls).toEqual([
      ['newPassword', { type: 'server', message: 'Use at least 10 characters.' }],
    ]);
  });

  test('other error codes are left to the caller even if they carry a list', () => {
    const error = new ApiError(401, 'INVALID_CREDENTIALS', 'T', 'R', undefined, [
      { field: 'x', message: 'y' },
    ]);
    expect(applyApiErrors(error, (() => undefined) as never)).toBe(false);
  });
});

test.describe('formatDateTime', () => {
  test('shows Indian time in the Indian style', () => {
    // 09:30 UTC is 15:00 in India (UTC+5:30).
    expect(formatDateTime('2026-10-18T09:30:00.000Z')).toMatch(/18 Oct 2026,? 3:00\s?pm/i);
  });

  test('returns the input unchanged when it is not a date', () => {
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});
