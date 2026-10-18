import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { DomainError } from '../../../common/errors/domain-error';

/**
 * How the browser apps keep the refresh token: in a cookie that JavaScript cannot read.
 *
 * WHY A COOKIE: if the refresh token lived in page storage, one injected script (XSS) could steal it and keep
 * access for 30 days. An `httpOnly` cookie is invisible to scripts. The 15-minute access token stays in memory.
 *
 * THE PRICE: browsers attach cookies automatically, which is what request forgery (CSRF) abuses: a malicious
 * site makes your browser call our API "as you". Three layers stop that:
 *   1. `SameSite=Strict`: the browser does not send the cookie on requests started from other sites.
 *   2. The cookie is only sent to `/v1/auth` paths, a tiny surface.
 *   3. Double-submit token: we also set a second, READABLE cookie (`dumbbill_csrf`) and require its value
 *      in an `X-CSRF-Token` header. Another site can make the browser SEND cookies, but cannot READ ours,
 *      so it cannot fill the header.
 * Mobile apps do not use cookies at all (they send the refresh token in the body), so none of this applies.
 */

export const REFRESH_COOKIE = 'dumbbill_rt';
export const CSRF_COOKIE = 'dumbbill_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Deployment-dependent cookie settings. */
export interface CookieSettings {
  /** True in production: cookies are only sent over HTTPS. */
  secure: boolean;
  /** Shared parent domain (for example `.dumbbill.in`) when the web app and API use different subdomains. */
  domain?: string;
}

/** Give the browser the refresh token (hidden) and a fresh CSRF token (readable). */
export function setRefreshCookies(
  res: Response,
  refreshToken: string,
  settings: CookieSettings,
): void {
  const base: CookieOptions = {
    secure: settings.secure,
    sameSite: 'strict',
    maxAge: THIRTY_DAYS_MS,
    ...(settings.domain ? { domain: settings.domain } : {}),
  };
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, httpOnly: true, path: '/v1/auth' });
  res.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
    ...base,
    httpOnly: false,
    path: '/',
  });
}

/** Remove both cookies (logout, or when the session turned out to be dead). */
export function clearRefreshCookies(res: Response, settings: CookieSettings): void {
  const base: CookieOptions = {
    secure: settings.secure,
    sameSite: 'strict',
    ...(settings.domain ? { domain: settings.domain } : {}),
  };
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true, path: '/v1/auth' });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false, path: '/' });
}

/** The refresh token from the cookie, if the browser sent one. */
export function readRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Require the double-submit proof for a request that authenticated with the cookie.
 * @throws DomainError CSRF_FAILED when the header is missing or does not match the CSRF cookie.
 */
export function assertCsrf(req: Request): void {
  const cookie = (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  if (typeof cookie !== 'string' || typeof header !== 'string' || cookie.length === 0) {
    throw new DomainError(
      'CSRF_FAILED',
      'The request could not be verified. Reload the page and try again.',
    );
  }
  const a = Buffer.from(cookie);
  const b = Buffer.from(header);
  // Constant-time comparison; lengths are checked first because timingSafeEqual needs equal lengths.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new DomainError(
      'CSRF_FAILED',
      'The request could not be verified. Reload the page and try again.',
    );
  }
}
