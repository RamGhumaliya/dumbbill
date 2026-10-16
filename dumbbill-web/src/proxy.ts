import { NextResponse, type NextRequest } from 'next/server';
import { env } from './lib/env';
import { buildContentSecurityPolicy, buildPermissionsPolicy, originOf } from './lib/security/csp';

/**
 * Runs on the server before every page is built (Next.js 16 calls this file the "proxy"; it used to be
 * called "middleware").
 *
 * Its job here: create a one-time secret ("nonce") for this request and attach a strict
 * Content-Security-Policy that only lets scripts carrying that nonce run. Next.js reads the header
 * and stamps the nonce onto its own scripts automatically. This is what stops injected scripts (XSS).
 *
 * Because every request needs its own nonce, pages are rendered per request rather than pre-built.
 * That is fine for this app: every screen is behind a login and shows live business data.
 */
export function proxy(request: NextRequest): NextResponse {
  // A fresh unpredictable value for this request, encoded the way CSP expects (base64).
  const nonce = btoa(crypto.randomUUID());

  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    apiOrigin: originOf(env.NEXT_PUBLIC_API_BASE_URL),
    sentryOrigin: env.NEXT_PUBLIC_SENTRY_DSN ? originOf(env.NEXT_PUBLIC_SENTRY_DSN) : undefined,
  });

  // Pass the policy and nonce down to the page rendering (Next.js uses them), and also send the
  // policy to the browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Permissions-Policy', buildPermissionsPolicy(request.nextUrl.pathname));
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except static files and Next's internal image/asset routes.
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
      // Skip link prefetches: they do not render a page, so they do not need a nonce.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
