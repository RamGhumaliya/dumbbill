import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { createApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

/**
 * The API client is used by every screen, so its behaviour is pinned down here with a fake `fetch`:
 * requests carry the right headers, every failure becomes a predictable ApiError, and the login is
 * renewed exactly once on a 401.
 */
const schema = z.object({ hello: z.string() });
const BASE = 'http://api.test';

type Recorded = { url: URL; init: RequestInit };

/** A fake fetch that answers from a queue of responses and records every call. */
function fakeFetch(
  ...answers: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>
) {
  const calls: Recorded[] = [];
  const impl = (async (input: URL | string, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    const next = answers.shift();
    if (!next) throw new Error('fakeFetch ran out of answers');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(init) : next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const problem = (overrides: Record<string, unknown> = {}, status = 422) =>
  json(
    {
      type: 'https://api.dumbbill.in/errors/x',
      title: 'Title',
      status,
      code: 'DISCOUNT_EXCEEDS_LIMIT',
      requestId: 'REQ-FROM-SERVER',
      ...overrides,
    },
    status,
    { 'content-type': 'application/problem+json' },
  );

const headerOf = (call: Recorded | undefined, name: string) =>
  (call?.init.headers as Record<string, string> | undefined)?.[name];

test.describe('request', () => {
  test('sends Accept and a fresh 26-character X-Request-Id, and returns the checked data', async () => {
    const { impl, calls } = fakeFetch(json({ hello: 'world' }));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });

    await expect(client.request({ path: '/x', schema })).resolves.toEqual({ hello: 'world' });
    expect(headerOf(calls[0], 'Accept')).toBe('application/json');
    expect(headerOf(calls[0], 'X-Request-Id')).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(headerOf(calls[0], 'Authorization')).toBeUndefined();
  });

  test('sends the access token as a Bearer header, but not when auth is false', async () => {
    const { impl, calls } = fakeFetch(json({ hello: 'a' }), json({ hello: 'b' }));
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl: impl,
      getAccessToken: () => 'TOKEN123',
    });

    await client.request({ path: '/private', schema });
    await client.request({ path: '/public', schema, auth: false });
    expect(headerOf(calls[0], 'Authorization')).toBe('Bearer TOKEN123');
    expect(headerOf(calls[1], 'Authorization')).toBeUndefined();
  });

  test('builds the query string, skipping undefined values', async () => {
    const { impl, calls } = fakeFetch(json({ hello: 'x' }));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    await client.request({
      path: '/products',
      query: { search: 'whey', page: 2, inStock: true, branch: undefined },
      schema,
    });
    expect(calls[0]?.url.toString()).toBe(`${BASE}/products?search=whey&page=2&inStock=true`);
  });

  test('sends JSON bodies with a content type, and the Idempotency-Key when given', async () => {
    const { impl, calls } = fakeFetch(json({ hello: 'x' }, 201));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    await client.request({
      method: 'POST',
      path: '/invoices',
      body: { total: 100 },
      idempotencyKey: 'KEY-1',
      schema,
    });
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"total":100}');
    expect(headerOf(calls[0], 'Content-Type')).toBe('application/json');
    expect(headerOf(calls[0], 'Idempotency-Key')).toBe('KEY-1');
  });
});

test.describe('failures become ApiError', () => {
  test('a standard problem body keeps its code, detail, field errors and the SERVER request id', async () => {
    const { impl } = fakeFetch(
      problem(
        {
          code: 'VALIDATION_FAILED',
          detail: 'Bad input',
          errors: [{ field: 'name', message: 'should not be empty' }],
        },
        400,
      ),
    );
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    const error = await client.request({ path: '/x', schema }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'Bad input',
      requestId: 'REQ-FROM-SERVER',
      fieldErrors: [{ field: 'name', message: 'should not be empty' }],
    });
  });

  test('an error status without the standard body becomes UNEXPECTED_RESPONSE with the id the server echoed', async () => {
    const { impl } = fakeFetch(
      new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'x-request-id': 'ECHOED-ID-123' },
      }),
    );
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    await expect(client.request({ path: '/x', schema })).rejects.toMatchObject({
      status: 502,
      code: 'UNEXPECTED_RESPONSE',
      requestId: 'ECHOED-ID-123',
    });
  });

  test('no connection becomes NETWORK_ERROR (status 0) but still carries a reference to quote', async () => {
    const { impl } = fakeFetch(new TypeError('fetch failed'));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    const error = (await client
      .request({ path: '/x', schema })
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(error.isNetwork).toBe(true);
    expect(error.requestId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('a slow server becomes TIMEOUT', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const { impl } = fakeFetch(hang);
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl, timeoutMs: 30 });
    await expect(client.request({ path: '/x', schema })).rejects.toMatchObject({
      code: 'TIMEOUT',
      status: 0,
    });
  });

  test('a cancellation by the caller is NOT turned into an API error', async () => {
    const controller = new AbortController();
    const hang = (init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const { impl } = fakeFetch(hang);
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    const pending = client
      .request({ path: '/x', schema, signal: controller.signal })
      .catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).name).toBe('AbortError');
  });

  test('a response that does not match the schema becomes INVALID_RESPONSE and names the problem', async () => {
    const { impl } = fakeFetch(json({ hello: 123 }, 200, { 'x-request-id': 'SRV-ID-0001' }));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    await expect(client.request({ path: '/x', schema })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      requestId: 'SRV-ID-0001',
      detail: expect.stringContaining('hello'),
    });
  });
});

test.describe('renewing the login on a 401', () => {
  const unauthenticated = () => problem({ code: 'UNAUTHENTICATED' }, 401);

  test('refreshes once, then repeats the call and succeeds', async () => {
    const { impl, calls } = fakeFetch(unauthenticated(), json({ hello: 'again' }));
    let refreshes = 0;
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl: impl,
      refreshAccessToken: async () => {
        refreshes += 1;
        return true;
      },
    });
    await expect(client.request({ path: '/x', schema })).resolves.toEqual({ hello: 'again' });
    expect(refreshes).toBe(1);
    expect(calls).toHaveLength(2);
  });

  test('when the refresh fails, tells the app the user is signed out and throws', async () => {
    const { impl } = fakeFetch(unauthenticated());
    let signedOut = 0;
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl: impl,
      refreshAccessToken: async () => false,
      onUnauthenticated: () => (signedOut += 1),
    });
    await expect(client.request({ path: '/x', schema })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    expect(signedOut).toBe(1);
  });

  test('never loops: a second 401 after a successful refresh is returned as an error', async () => {
    const { impl, calls } = fakeFetch(unauthenticated(), unauthenticated());
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl: impl,
      refreshAccessToken: async () => true,
    });
    await expect(client.request({ path: '/x', schema })).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(2);
  });

  test('calls that fail at the same moment share ONE refresh', async () => {
    const { impl } = fakeFetch(
      unauthenticated(),
      unauthenticated(),
      json({ hello: '1' }),
      json({ hello: '2' }),
    );
    let refreshes = 0;
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl: impl,
      refreshAccessToken: async () => {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      },
    });
    await Promise.all([
      client.request({ path: '/a', schema }),
      client.request({ path: '/b', schema }),
    ]);
    expect(refreshes).toBe(1);
  });

  test('public calls (auth: false) never trigger a refresh', async () => {
    const { impl } = fakeFetch(unauthenticated());
    let refreshes = 0;
    const client = createApiClient({
      baseUrl: BASE,
      fetchImpl: impl,
      refreshAccessToken: async () => {
        refreshes += 1;
        return true;
      },
    });
    await expect(client.request({ path: '/login', schema, auth: false })).rejects.toMatchObject({
      status: 401,
    });
    expect(refreshes).toBe(0);
  });

  test('sends a FormData body as multipart, leaving the Content-Type for the browser to write', async () => {
    const { impl, calls } = fakeFetch(json({ hello: 'ok' }));
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'image/png' }), 'logo.png');
    await client.request({ method: 'PUT', path: '/v1/business/logo', body: form, schema });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.init.body).toBe(form);
    // Without the browser's own value the multipart boundary would be missing and the server could not read the file.
    expect(headers['Content-Type']).toBeUndefined();
  });

  test('can read a successful answer as a file, while errors are still read as problem bodies', async () => {
    const { impl } = fakeFetch(
      new Response('PNGDATA', { status: 200, headers: { 'content-type': 'image/png' } }),
      problem({ code: 'NOT_FOUND' }, 404),
    );
    const client = createApiClient({ baseUrl: BASE, fetchImpl: impl });
    const blob = await client.request({
      path: '/v1/business/logo',
      expect: 'blob',
      schema: z.instanceof(Blob),
    });
    expect(await blob.text()).toBe('PNGDATA');
    await expect(
      client.request({ path: '/v1/business/logo', expect: 'blob', schema: z.instanceof(Blob) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
