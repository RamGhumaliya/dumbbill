import type { ApiClient } from '../client';
import { livenessSchema, readinessSchema, type Liveness, type Readiness } from '../schemas/system';

/**
 * "System" endpoints. The pattern for every endpoint file:
 *   - one function per endpoint, named exactly like the operationId in the Swagger manual
 *   - the client is passed in, so the same function works in the browser, on the server and in tests
 *   - the response schema lives in ../schemas and is checked by the client
 */

/** operationId getLiveness. Permission: public. */
export function getLiveness(client: ApiClient, signal?: AbortSignal): Promise<Liveness> {
  return client.request({ path: '/healthz', schema: livenessSchema, auth: false, signal });
}

/** operationId getReadiness. Permission: public. */
export function getReadiness(client: ApiClient, signal?: AbortSignal): Promise<Readiness> {
  return client.request({ path: '/readyz', schema: readinessSchema, auth: false, signal });
}
