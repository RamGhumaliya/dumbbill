import { refreshResponseSchema } from './schemas/auth';
import { newRequestId } from './request-id';

/**
 * Where the login lives in the browser, and how it is renewed.
 *
 * The full picture is in docs/api/auth-flow.md. In short:
 *  - The short-lived ACCESS token (15 minutes) is kept only in memory (a variable here). It is never written
 *    to localStorage or a normal cookie, because scripts injected into the page could read those.
 *  - The longer-lived REFRESH token is an httpOnly cookie set by the API, which scripts cannot read at all.
 *    After a page reload the access token is gone, and the cookie is used to get a new one.
 *  - A second cookie, `dumbbill_csrf`, IS readable. Renewing the login sends its value in the `X-CSRF-Token`
 *    header. A malicious site can make the browser send our cookies but cannot read this one to fill the header,
 *    which is what stops cross-site request forgery.
 *
 * This module is for the BROWSER only. On the server one module-level variable would be shared by every visitor's
 * request, so server code must never call these functions.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

/** Name of the readable cookie that proves a request comes from our own pages. Set by the API at sign-in. */
export const CSRF_COOKIE = 'dumbbill_csrf';

/** Read the CSRF cookie from `document.cookie` (a string like `a=1; dumbbill_csrf=xyz; b=2`). */
export function readCsrfToken(cookieString?: string): string | null {
  const source = cookieString ?? (typeof document === 'undefined' ? '' : document.cookie);
  for (const part of source.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) return rest.join('=') || null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Signed-out notification: lets the session store hear about a dead login without this file importing it.
// ---------------------------------------------------------------------------------------------
const signedOutListeners = new Set<() => void>();

/** Run `listener` whenever the login is found to be dead (the refresh failed). Returns a function that stops it. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

/** Forget the access token and tell everyone listening that the person is signed out. */
export function notifySignedOut(): void {
  clearAccessToken();
  for (const listener of signedOutListeners) listener();
}

// ---------------------------------------------------------------------------------------------
// Renewing the login
// ---------------------------------------------------------------------------------------------

export interface RefresherOptions {
  /** Address of the API without a trailing slash. */
  baseUrl: string;
  /** For tests: replaces the global fetch. */
  fetchImpl?: typeof fetch;
  /** For tests: replaces reading `document.cookie`. */
  getCsrfToken?: () => string | null;
}

/**
 * Builds the function that renews the login with the refresh cookie. Resolves true when a new access token was
 * stored, false when the person must sign in again. It never throws.
 *
 * Without the readable CSRF cookie there cannot be a refresh cookie either (the API sets them together), so in
 * that case it answers false at once, with no network call: a first-time visitor does not trigger a pointless request.
 *
 * Calls made at the same moment share one request. (If two did slip through, the API tolerates a second refresh
 * within a few seconds, so a double refresh does not log anyone out.)
 */
export function createTokenRefresher(options: RefresherOptions): () => Promise<boolean> {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const getCsrf = options.getCsrfToken ?? readCsrfToken;
  let inFlight: Promise<boolean> | undefined;

  async function refresh(): Promise<boolean> {
    const csrf = getCsrf();
    if (!csrf) return false;
    try {
      const response = await doFetch(new URL('/v1/auth/refresh', `${options.baseUrl}/`), {
        method: 'POST',
        // `include` sends the httpOnly refresh cookie to the API, which lives at another address.
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'X-Request-Id': newRequestId(),
        },
        body: '{}',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return false;
      const parsed = refreshResponseSchema.safeParse(await response.json());
      if (!parsed.success) return false;
      setAccessToken(parsed.data.accessToken);
      return true;
    } catch {
      // No connection or a timeout: we cannot renew now. The caller treats this like "not signed in".
      return false;
    }
  }

  return () => {
    inFlight ??= refresh().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
