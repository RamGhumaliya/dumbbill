import { z } from 'zod';

/**
 * Shapes of the "System" endpoints, written from the backend's Swagger manual (http://localhost:3000/docs).
 * If the backend changes one of these, the checks fail with a clear message here instead of silently
 * breaking a screen.
 */

/** GET /healthz: is the server process alive. */
export const livenessSchema = z.object({
  status: z.literal('ok'),
});
export type Liveness = z.infer<typeof livenessSchema>;

/** GET /readyz: can the server reach its database. */
export const readinessSchema = z.object({
  status: z.literal('ok'),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;
