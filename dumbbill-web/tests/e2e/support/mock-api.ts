import type { BrowserContext, Page } from '@playwright/test';

/**
 * A pretend Dumbbill API for browser tests of the sign-in screens.
 *
 * Why pretend: these tests are about what the SCREENS do (messages, redirects, what is sent), and they must run
 * without a database, Redis or mail server. The REAL server behaviour is covered by the backend's own tests; and the
 * request shapes used here are the ones in docs/api/auth-flow.md, so a screen that works against this works against
 * the real API.
 *
 * It intercepts the browser's calls to the API address, records every call (so tests can check exactly what was
 * sent: which headers, which body), and answers from handlers the test registers:
 *
 *   const api = await installMockApi(page);
 *   api.on('POST /v1/auth/login', () => ({ status: 401, problem: 'INVALID_CREDENTIALS' }));
 *
 * The browser treats the API (port 3000) as another origin from the web app (port 3100), so every answer carries the
 * CORS headers the real API sends, including permission for cookies. Without them the browser would block the reply.
 */
export const API_ORIGIN = 'http://localhost:3000';
export const WEB_ORIGIN = 'http://localhost:3100';

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

/** What a handler answers. `problem` builds a standard error body from a code. */
export interface Reply {
  status?: number;
  json?: unknown;
  /** A catalogue error code: answered as application/problem+json with this code. */
  problem?: string;
  /** For error bodies: extra fields such as `errors`. */
  problemExtra?: Record<string, unknown>;
  headers?: Record<string, string>;
}

type Handler = (call: RecordedCall) => Reply | Promise<Reply>;

const STATUS_FOR_CODE: Record<string, number> = {
  INVALID_CREDENTIALS: 401,
  TOTP_REQUIRED: 401,
  INVALID_TOTP_CODE: 401,
  EMAIL_NOT_VERIFIED: 403,
  RATE_LIMITED: 429,
  INVALID_TOKEN: 400,
  INVALID_REFRESH_TOKEN: 401,
  UNAUTHENTICATED: 401,
  WEAK_PASSWORD: 422,
  VALIDATION_FAILED: 400,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

const CORS_HEADERS = {
  'access-control-allow-origin': WEB_ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE',
  'access-control-allow-headers':
    'content-type,authorization,x-csrf-token,x-request-id,idempotency-key,accept',
  'access-control-expose-headers': 'x-request-id,retry-after',
};

export class MockApi {
  /** Every call the browser made, oldest first. */
  readonly calls: RecordedCall[] = [];
  private readonly handlers = new Map<string, Handler>();

  /** Answer calls matching "METHOD /path". A later registration replaces an earlier one. */
  on(key: string, handler: Handler | Reply): void {
    this.handlers.set(key, typeof handler === 'function' ? handler : () => handler);
  }

  /** How many calls matched "METHOD /path". */
  count(key: string): number {
    return this.calls.filter((call) => `${call.method} ${call.path}` === key).length;
  }

  /** The most recent call matching "METHOD /path". */
  last(key: string): RecordedCall | undefined {
    return [...this.calls].reverse().find((call) => `${call.method} ${call.path}` === key);
  }

  /** @internal */
  find(key: string): Handler | undefined {
    return this.handlers.get(key);
  }
}

/** The sample person and business used across tests. */
export const SAMPLE_USER = {
  id: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
  email: 'ravi@fitfuel.in',
  fullName: 'Ravi Mehta',
  isOwner: true,
  totpEnabled: false,
};
export const SAMPLE_TENANT = {
  id: '0192a3b4-1111-7e8f-9a0b-1c2d3e4f5a6b',
  name: 'FitFuel Nutrition',
  status: 'TRIAL',
  trialEndsAt: '2026-11-01T09:30:00.000Z',
};
export const SAMPLE_LOGIN = {
  accessToken: 'test-access-token',
  tokenType: 'Bearer',
  expiresInSeconds: 900,
  user: SAMPLE_USER,
  tenant: SAMPLE_TENANT,
};

/** Start intercepting the browser's calls to the API address. */
export async function installMockApi(page: Page): Promise<MockApi> {
  const api = new MockApi();
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();

    // The browser first asks "may this page call you with these headers?" (a CORS preflight).
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }

    const path = new URL(request.url()).pathname;
    const raw = request.postData();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const call: RecordedCall = { method: request.method(), path, body, headers: request.headers() };
    api.calls.push(call);

    const handler = api.find(`${call.method} ${call.path}`) ?? api.find(`${call.method} *`);
    const reply: Reply = handler
      ? await handler(call)
      : {
          status: 404,
          problem: 'NOT_FOUND',
          problemExtra: { detail: 'No mock handler registered.' },
        };

    const status = reply.problem
      ? (reply.status ?? STATUS_FOR_CODE[reply.problem] ?? 400)
      : (reply.status ?? 200);
    const payload = reply.problem
      ? {
          type: `https://api.dumbbill.in/errors/${reply.problem.toLowerCase().replace(/_/g, '-')}`,
          title: reply.problem,
          status,
          code: reply.problem,
          requestId: '01JTESTREQUESTID00000000000',
          ...reply.problemExtra,
        }
      : reply.json;

    await route.fulfill({
      status,
      headers: {
        ...CORS_HEADERS,
        ...(reply.problem ? { 'content-type': 'application/problem+json' } : {}),
        ...reply.headers,
      },
      ...(status === 204 || payload === undefined
        ? {}
        : {
            contentType: reply.problem ? 'application/problem+json' : 'application/json',
            body: JSON.stringify(payload),
          }),
    });
  });
  return api;
}

/**
 * Make the browser look signed in: the readable CSRF cookie that the real API sets at sign-in exists, and the
 * renew and "who am I" calls succeed. Used by the specs that open the screens behind the sign-in gate.
 */
export async function signIn(page: Page, context: BrowserContext): Promise<MockApi> {
  await context.addCookies([{ name: 'dumbbill_csrf', value: 'test-csrf-token', url: WEB_ORIGIN }]);
  const api = await installMockApi(page);
  api.on('POST /v1/auth/refresh', {
    json: { accessToken: 'test-access-token', tokenType: 'Bearer', expiresInSeconds: 900 },
  });
  api.on('GET /v1/auth/me', { json: { user: SAMPLE_USER, tenant: SAMPLE_TENANT } });
  api.on('POST /v1/auth/logout', { status: 204 });
  return api;
}
