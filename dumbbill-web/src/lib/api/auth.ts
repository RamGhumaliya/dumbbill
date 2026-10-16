/**
 * Where the login token lives in the browser.
 *
 * Security decision: the short-lived ACCESS token is kept only in memory (a variable here). It is never
 * written to localStorage or a normal cookie, because scripts injected into the page could read those.
 * The longer-lived REFRESH token is an httpOnly cookie set by the server, which scripts cannot read at
 * all. After a page reload the access token is gone, and the refresh cookie is used to get a new one.
 *
 * This module is for the BROWSER only. On the server one module-level variable would be shared by
 * every visitor's request, so server code must never call these functions.
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

/**
 * Placeholder for "renew the login with the refresh cookie".
 *
 * STUB until P1-1 (authentication) adds the endpoint on the server. It reports "could not renew", so
 * a 401 sends the user to sign in again, which is the correct behaviour while there is no refresh yet.
 * When the endpoint exists, this will call POST /v1/auth/refresh with `credentials: 'include'`, store
 * the new access token with setAccessToken, and return true.
 */
export async function refreshAccessToken(): Promise<boolean> {
  return false;
}
