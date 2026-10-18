import type { z } from 'zod';
import { ApiError, parseProblem } from './errors';
import { newRequestId } from './request-id';

/**
 * The one function every API call goes through. It handles the things every call needs, so individual
 * endpoint functions (see ./endpoints) stay tiny:
 *
 *   - sends the access token (`Authorization: Bearer ...`)
 *   - sends a fresh `X-Request-Id` so any failure can be traced in the server logs
 *   - turns every failure into an `ApiError` (server problem body, network failure, timeout, bad shape)
 *   - checks the successful response against a zod schema, so a change on the server shows up as a
 *     clear error here instead of `undefined` deep inside a screen
 *   - on a 401 tries to refresh the login ONCE and repeats the call
 *
 * Nothing here retries a request on its own: repeating a request that creates a bill is dangerous
 * unless it carries an Idempotency-Key, and that decision belongs to the caller.
 */
export interface ApiClientOptions {
  /** Address of the API without a trailing slash, for example http://localhost:3000. */
  baseUrl: string;
  /** Returns the current access token, or null when signed out. */
  getAccessToken?: () => string | null;
  /**
   * Called after a 401 to get a new access token (the refresh token lives in an httpOnly cookie).
   * Return true if the access token was renewed, false if the user must sign in again.
   * It is called once per failed call and shared between calls that fail at the same moment.
   */
  refreshAccessToken?: () => Promise<boolean>;
  /** Called when the user is definitely signed out, so the app can show the login screen. */
  onUnauthenticated?: () => void;
  /** Give up waiting after this many milliseconds. Default 15000. */
  timeoutMs?: number;
  /**
   * Whether the browser sends cookies with each call. The web app uses `include`: the API lives on another
   * address (same site, different port or subdomain), and the refresh token is an httpOnly cookie.
   */
  credentials?: RequestCredentials;
  /** For tests: replaces the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions<TSchema extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path starting with "/", for example "/readyz". */
  path: string;
  /** Query string values. Undefined values are left out. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Request body, sent as JSON. */
  body?: unknown;
  /** What a successful response must look like. */
  schema: TSchema;
  /** Required by the API on calls that create money records (bills, payments). Reuse it when retrying. */
  idempotencyKey?: string;
  /** Extra headers for this call, for example `X-CSRF-Token` on calls authenticated by the refresh cookie. */
  headers?: Record<string, string>;
  /** Set false for public endpoints (login, health). Default true. */
  auth?: boolean;
  /** Lets the caller cancel (for example when the user leaves the screen). */
  signal?: AbortSignal;
}

export interface ApiClient {
  request<TSchema extends z.ZodType>(options: RequestOptions<TSchema>): Promise<z.output<TSchema>>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // If several calls get a 401 together, they should share ONE refresh, not start many.
  let refreshInFlight: Promise<boolean> | undefined;
  const refreshOnce = (): Promise<boolean> => {
    const refresh = options.refreshAccessToken;
    if (!refresh) return Promise.resolve(false);
    refreshInFlight ??= refresh().finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  };

  /** One attempt: build the request, send it, and turn the answer into data or an ApiError. */
  async function attempt<TSchema extends z.ZodType>(
    request: RequestOptions<TSchema>,
  ): Promise<z.output<TSchema>> {
    const requestId = newRequestId();
    const url = new URL(request.path, `${options.baseUrl}/`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-Id': requestId,
      ...request.headers,
    };
    const token = request.auth === false ? null : (options.getAccessToken?.() ?? null);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';

    // Stop waiting after the timeout; also stop if the caller cancels.
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: options.credentials,
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw error; // the caller cancelled on purpose: not an API failure
      if (timeout.aborted) {
        throw new ApiError(0, 'TIMEOUT', 'The server took too long to answer', requestId);
      }
      throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server', requestId);
    }

    // The server echoes the id (or replaces an unsafe one). Prefer what the server says it used.
    const serverRequestId = response.headers.get('x-request-id') ?? requestId;
    const body: unknown = await readBody(response);

    if (!response.ok) {
      const problem = parseProblem(body);
      if (problem) throw ApiError.fromProblem(problem, readRetryAfter(response));
      throw new ApiError(
        response.status,
        'UNEXPECTED_RESPONSE',
        `The server answered ${response.status}`,
        serverRequestId,
      );
    }

    const parsed = request.schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        'The server answered in an unexpected format',
        serverRequestId,
        parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
          .join('; '),
      );
    }
    return parsed.data;
  }

  return {
    async request(request) {
      try {
        return await attempt(request);
      } catch (error) {
        // A 401 on a call that needed login: renew the login once and repeat the call.
        if (error instanceof ApiError && error.isUnauthenticated && request.auth !== false) {
          if (await refreshOnce()) return attempt(request);
          options.onUnauthenticated?.();
        }
        throw error;
      }
    },
  };
}

/** Read the response body as JSON when there is one (204 and empty bodies give undefined). */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The `Retry-After` header as a number of seconds (the API always sends whole seconds). */
function readRetryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
