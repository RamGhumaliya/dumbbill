/**
 * Who is making the current request, after the access token was checked.
 * Set on `request.auth` by the auth middleware and read with the `@CurrentUser()` decorator.
 */
export interface AuthenticatedUser {
  /** The staff member. */
  userId: string;
  /** Their business. Also the tenant context the database uses (see tenancy/tenant-context.ts). */
  tenantId: string;
  /** The sign-in (device) this request belongs to. */
  sessionId: string;
}

// Adds `request.auth` to Express's Request type. (The global `Express.Request` interface is the supported
// extension point; Express's own Request type extends it.)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present when a valid access token was sent. Absent on public routes. */
      auth?: AuthenticatedUser;
    }
  }
}
