import type { ApiClient } from '../client';
import {
  acceptedSchema,
  loginResponseSchema,
  meResponseSchema,
  noContentSchema,
  sessionListSchema,
  totpEnabledSchema,
  totpSetupSchema,
  type Accepted,
  type LoginResponse,
  type MeResponse,
  type SessionList,
  type TotpEnabled,
  type TotpSetup,
} from '../schemas/auth';

/**
 * "Auth" endpoints: one function per endpoint, named exactly like the operationId in the Swagger manual.
 * How the pieces fit together (tokens, cookies, the CSRF header) is explained in docs/api/auth-flow.md.
 *
 * Notes that apply to all of them:
 *  - Public endpoints pass `auth: false` so no stale access token is attached.
 *  - Endpoints that must not reveal whether an email has an account (signUp, resendVerificationEmail,
 *    requestPasswordReset) always answer the same way: screens must not try to say "email already used".
 */

/** operationId signUp. Permission: public. Creates a business and its owner; the email must be verified before sign-in. */
export function signUp(
  client: ApiClient,
  body: { businessName: string; ownerName: string; email: string; password: string },
): Promise<Accepted> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/signup',
    body,
    schema: acceptedSchema,
    auth: false,
  });
}

/** operationId verifyEmail. Permission: public. The token comes from the link in the verification email. */
export function verifyEmail(client: ApiClient, token: string): Promise<void> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/verify-email',
    body: { token },
    schema: noContentSchema,
    auth: false,
  });
}

/** operationId resendVerificationEmail. Permission: public. Always answers the same, whether or not the email exists. */
export function resendVerificationEmail(client: ApiClient, email: string): Promise<Accepted> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/resend-verification',
    body: { email },
    schema: acceptedSchema,
    auth: false,
  });
}

/**
 * operationId logIn. Permission: public.
 * Always sent with `clientType: 'WEB'`, so the refresh token arrives as an httpOnly cookie and never in JSON.
 * Throws ApiError TOTP_REQUIRED when the account uses an authenticator app (repeat with `totpCode`).
 */
export function logIn(
  client: ApiClient,
  body: { email: string; password: string; totpCode?: string; recoveryCode?: string },
): Promise<LoginResponse> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/login',
    body: { ...body, clientType: 'WEB' },
    schema: loginResponseSchema,
    auth: false,
  });
}

/**
 * operationId logOut. Permission: public (the refresh cookie is the credential).
 * The cookie is sent automatically; `csrfToken` is the value of the readable `dumbbill_csrf` cookie.
 */
export function logOut(client: ApiClient, csrfToken: string | null): Promise<void> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/logout',
    body: {},
    schema: noContentSchema,
    auth: false,
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
  });
}

/** operationId getCurrentUser. Permission: any signed-in user. */
export function getCurrentUser(client: ApiClient, signal?: AbortSignal): Promise<MeResponse> {
  return client.request({ path: '/v1/auth/me', schema: meResponseSchema, signal });
}

/** operationId requestPasswordReset. Permission: public. Always answers the same, whether or not the email exists. */
export function requestPasswordReset(client: ApiClient, email: string): Promise<Accepted> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/forgot-password',
    body: { email },
    schema: acceptedSchema,
    auth: false,
  });
}

/** operationId resetPassword. Permission: public (the emailed token is the credential). Ends every session. */
export function resetPassword(
  client: ApiClient,
  body: { token: string; newPassword: string },
): Promise<void> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/reset-password',
    body,
    schema: noContentSchema,
    auth: false,
  });
}

/** operationId changePassword. Permission: any signed-in user. Ends the OTHER sessions. */
export function changePassword(
  client: ApiClient,
  body: { currentPassword: string; newPassword: string },
): Promise<void> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/change-password',
    body,
    schema: noContentSchema,
  });
}

/** operationId listSessions. Permission: any signed-in user (own sessions). */
export function listSessions(client: ApiClient, signal?: AbortSignal): Promise<SessionList> {
  return client.request({ path: '/v1/auth/sessions', schema: sessionListSchema, signal });
}

/** operationId revokeSession. Permission: any signed-in user (own sessions). */
export function revokeSession(client: ApiClient, sessionId: string): Promise<void> {
  return client.request({
    method: 'DELETE',
    path: `/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
    schema: noContentSchema,
  });
}

/** operationId startTotpSetup. Permission: any signed-in user. Two-step login stays OFF until `enableTotp`. */
export function startTotpSetup(client: ApiClient): Promise<TotpSetup> {
  return client.request({ method: 'POST', path: '/v1/auth/totp/setup', schema: totpSetupSchema });
}

/**
 * operationId enableTotp. Permission: any signed-in user. Needs the account password as well as the first code, so a
 * stolen session cannot lock the owner out. Returns the one-time recovery codes (shown once).
 */
export function enableTotp(
  client: ApiClient,
  input: { code: string; currentPassword: string },
): Promise<TotpEnabled> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/totp/enable',
    body: input,
    schema: totpEnabledSchema,
  });
}

/** operationId disableTotp. Permission: any signed-in user. Needs the password and a current (or recovery) code. */
export function disableTotp(
  client: ApiClient,
  body: { password: string; code: string },
): Promise<void> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/totp/disable',
    body,
    schema: noContentSchema,
  });
}

/**
 * operationId acceptInvitation. Permission: public (the emailed token is the credential).
 * The invited person chooses their password. A refused password (WEAK_PASSWORD) does not use up the link.
 */
export function acceptInvitation(
  client: ApiClient,
  body: { token: string; password: string },
): Promise<void> {
  return client.request({
    method: 'POST',
    path: '/v1/auth/accept-invitation',
    body,
    schema: noContentSchema,
    auth: false,
  });
}
