import { env } from '../env';
import { createTokenRefresher, getAccessToken, notifySignedOut, readCsrfToken } from './auth';
import { createApiClient, type ApiClient } from './client';

export { ApiError, parseProblem, type ProblemDetails, type FieldError } from './errors';
export { createApiClient, type ApiClient } from './client';
export * as systemApi from './endpoints/system';
export * as authApi from './endpoints/auth';
export * as businessApi from './endpoints/business';
export { readCsrfToken } from './auth';

/** Renews the login with the refresh cookie. Built once; shared by the API client and the session restore. */
let browserRefresher: (() => Promise<boolean>) | undefined;
export function refreshBrowserLogin(): Promise<boolean> {
  browserRefresher ??= createTokenRefresher({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL });
  return browserRefresher();
}

/**
 * The API client for code running in the BROWSER: uses the in-memory access token, sends cookies (the refresh
 * token is an httpOnly cookie) and renews the login once when a call is answered with 401.
 * Created on first use so importing this file costs nothing.
 */
let browserClient: ApiClient | undefined;
export function getBrowserApiClient(): ApiClient {
  browserClient ??= createApiClient({
    baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    getAccessToken,
    refreshAccessToken: refreshBrowserLogin,
    onUnauthenticated: notifySignedOut,
    credentials: 'include',
  });
  return browserClient;
}

/** The CSRF value to send with sign-out (read at call time, because the cookie changes at every refresh). */
export function currentCsrfToken(): string | null {
  return readCsrfToken();
}

/**
 * The API client for code running on the SERVER (Server Components). It has no shared token store on
 * purpose: on the server one variable would be shared by every visitor. Pages that need a signed-in
 * call would pass the token explicitly. Today the screens behind login fetch in the browser, because the
 * access token lives only in browser memory.
 */
export function createServerApiClient(): ApiClient {
  return createApiClient({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL, timeoutMs: 5_000 });
}
