import { z } from 'zod';

/**
 * Shapes of the "Auth" endpoints, written from the backend's Swagger manual (http://localhost:3000/docs) and
 * the guide docs/api/auth-flow.md. If the backend changes one of these, the checks fail with a clear message
 * here instead of silently breaking a screen.
 *
 * Money and secrets never appear here: the API never sends a password hash, token hash or authenticator
 * secret (except the one-time setup secret and recovery codes, which are shown once and not kept).
 */

/** Answer to requests that must not reveal whether an account exists (signup, resend, forgot password). */
export const acceptedSchema = z.object({ message: z.string() });
export type Accepted = z.infer<typeof acceptedSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  isOwner: z.boolean(),
  totpEnabled: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']),
  trialEndsAt: z.string().nullable(),
});
export type AuthTenant = z.infer<typeof authTenantSchema>;

/** POST /v1/auth/login. For browser sign-in the refresh token is a cookie, so it is not in this body. */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().int(),
  user: authUserSchema,
  tenant: authTenantSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** POST /v1/auth/refresh. */
export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().int(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

/** GET /v1/auth/me. */
export const meResponseSchema = z.object({ user: authUserSchema, tenant: authTenantSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;

/** A signed-in device, as listed on the account security screen. */
export const sessionSchema = z.object({
  id: z.string(),
  deviceLabel: z.string(),
  clientType: z.enum(['WEB', 'MOBILE']),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  current: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionListSchema = z.object({ sessions: z.array(sessionSchema) });
export type SessionList = z.infer<typeof sessionListSchema>;

/** POST /v1/auth/totp/setup. */
export const totpSetupSchema = z.object({ secret: z.string(), otpAuthUri: z.string() });
export type TotpSetup = z.infer<typeof totpSetupSchema>;

/** POST /v1/auth/totp/enable. The recovery codes are shown once. */
export const totpEnabledSchema = z.object({ recoveryCodes: z.array(z.string()) });
export type TotpEnabled = z.infer<typeof totpEnabledSchema>;

/** For endpoints that answer 204 No Content: there is no body to check. */
export const noContentSchema = z.undefined();
