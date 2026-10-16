import { env } from '../env';
import { clearAccessToken, getAccessToken, refreshAccessToken } from './auth';
import { createApiClient, type ApiClient } from './client';

export { ApiError, parseProblem, type ProblemDetails, type FieldError } from './errors';
export { createApiClient, type ApiClient } from './client';
export * as systemApi from './endpoints/system';

/**
 * The API client for code running in the BROWSER: uses the in-memory access token and the refresh stub.
 * Created on first use so importing this file costs nothing.
 */
let browserClient: ApiClient | undefined;
export function getBrowserApiClient(): ApiClient {
  browserClient ??= createApiClient({
    baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    getAccessToken,
    refreshAccessToken,
    onUnauthenticated: clearAccessToken,
  });
  return browserClient;
}

/**
 * The API client for code running on the SERVER (Server Components). It has no shared token store on
 * purpose: on the server one variable would be shared by every visitor. Pages that need a signed-in
 * call will pass the token explicitly from the request's cookies (added with authentication in P1-1).
 */
export function createServerApiClient(): ApiClient {
  return createApiClient({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL, timeoutMs: 5_000 });
}
