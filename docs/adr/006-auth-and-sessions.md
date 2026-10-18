# ADR 006: Authentication and session design

- Status: Accepted as design (17 Oct 2026). Built in P1-1 (staff) and Phase 3 (customers).
- Deciders: Owner, architect agent
- Related: `docs/03-engineering/security.md` §2, §3, `docs/03-engineering/architecture.md` §9, ADR 003

## 1. Context

There are two separate kinds of user: **staff** (owner, manager, cashier, who belong to one business) and **customers** (shoppers with one login across many shops). Staff use a web app and the owner mobile app; customers use the customer mobile app. A stolen session on the POS must not become a data breach, and a stolen customer login must never reach business data.

## 2. Decision

### Passwords
1. **Argon2id** hashing (about 64 MB memory, 3 passes, tuned on the real server), plus a **pepper** kept outside the database (an environment secret now, a secrets manager later).
2. Minimum 10 characters, maximum 128, **no composition rules** (no "must have a symbol"), and a **breached-password check** (k-anonymity range lookup, so the password never leaves the server).
3. Email verification is mandatory. **Staff accounts are invited by the owner**; there is no open staff signup.
4. Generic error messages ("email or password is incorrect"), rate limiting and progressive delay on login to resist credential stuffing.

### Tokens and sessions
5. **Access token:** a short-lived JWT (15 minutes), signed with an asymmetric key and a `kid` so keys can be rotated. Web keeps it **in memory only**.
6. **Refresh token:** 30 days, sliding, **rotated on every use**. Reuse of an old refresh token revokes the whole token family (a sign of theft). Web stores it in an **httpOnly, Secure, SameSite=Strict cookie**; mobile uses the platform secure store (Keychain / Keystore, via `flutter_secure_storage`).
7. **Session list and revoke.** Users can see their devices and sign out others; changing the password signs out everywhere.
8. **Mobile apps refresh once on a 401**, then log out (already built into the P0-6 network layer).
9. **Optional TOTP two-factor** for Owner and Admin accounts; **mandatory** for Super Admin. Passkeys later.
10. **Cashier PIN:** a 6-digit PIN (hashed, rate-limited, bound to the device) is used only for quick approvals and shift changes. It **never replaces** the primary login.

### Two identity pools
11. Staff and customers are **separate**: different tables, different token audiences (`aud`) and issuers, different guards, and (see ADR 003) different database roles. A customer token cannot reach a staff route and the reverse.
12. Customers sign in with **email and password** (decided), with email verification, breached-password check, rate limits, and an **email one-time-code step-up on a new device**.

### Authorization is separate from authentication
13. Every route declares a permission key (`@Permission('products.cost.read')`); the guard is deny-by-default. Roles are editable presets of permissions; code never checks `role === 'admin'`. See security.md §3.

### Web-specific protections
14. Strict CSP with per-request nonce (built in P0-4), CSRF defence for the cookie-authenticated refresh endpoint (SameSite=Strict plus a double-submit token), and no `dangerouslySetInnerHTML`.

## 3. Consequences

Good:
- An XSS bug cannot read the long-lived refresh token (httpOnly) and only gets a 15-minute access token that is never written to storage.
- Stolen refresh tokens are detected and cut off by rotation and family revocation.
- Customer and staff compromise cannot cross over.

Costs and caveats:
- In-memory access tokens mean a page reload needs a silent refresh call; the web client handles this at start-up.
- Refresh-token rotation needs careful handling of two tabs refreshing at once (a short grace window, designed in P1-1) so a normal user is not logged out by their own second tab.
- Argon2id is memory-hungry; parameters must be tuned so that login stays fast on the small production server and is not a denial-of-service lever (rate limits protect it).
- The pepper and signing keys become secrets to manage and rotate (see `docs/runbooks/rotate-secrets.md`).
- Open item for P1-1: how long a 15-minute access token may keep working after a user is disabled. Default: it works until it expires; high-risk actions re-check the user's status in the database.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Server-side session cookies only | Simple, but the mobile apps and the API-first design fit token auth better; separating access and refresh tokens limits damage from theft. |
| Long-lived access tokens | One leak gives weeks of access. Short tokens plus rotating refresh limit the damage. |
| Storing tokens in `localStorage` on web | Readable by any injected script. Rejected in favour of memory plus an httpOnly cookie. |
| Customers and staff in one table | One bug could expose business data to shoppers. Kept apart on purpose. |
| Phone-number OTP login for customers | Costs money per message and is weaker for this product; the owner chose email and password. |

## 6. Implementation notes (P1-1, 18 Oct 2026)

What was built, the decisions taken while building it, and the limits to be aware of. Code: `dumbbill-backend/src/modules/auth/`. Integration guide for the apps: `docs/api/auth-flow.md`.

**Tokens carry the business id.** Row-level security needs to know the business before it shows any row, but a token arrives before we know whose it is. So every refresh and emailed token is `<tenantId>.<secret>`: the id selects the business, the secret (256 random bits) is checked against a stored SHA-256 hash. A token moved to another business finds nothing (tested). Only hashes are stored.

**Login by email** uses the `find_login_by_email()` database function described in ADR 002, with one correction found while building: `users` has FORCE row-level security, so a function owned by the normal table owner would see no rows in production (a non-superuser owner is bound by the policies too). It is therefore owned by a dedicated role, `dumbbill_auth` (cannot log in, no RLS bypass, SELECT on eight named columns only, one SELECT-only policy). Caveat for production: the migration changes the function's owner, which needs the migration role to be allowed to do that (a superuser, or a member of `dumbbill_auth`).

**Refresh rotation and reuse.** Each refresh token works once. Reusing an old one ends the whole session (`TOKEN_REUSE`, audited) **unless** it arrives within 10 seconds of its first use, which is treated as two tabs refreshing together: the second caller gets an access token but no new refresh token (the cookie set by the first response already holds it). The claim is one atomic database update, so exactly one of two simultaneous refreshes wins. The trade-off: a thief replaying a just-used token inside that 10-second window gets one access token (15 minutes) but no new refresh token and so cannot continue.

**Immediate revocation.** A short-lived list in Redis holds ended session ids for the access-token lifetime (15 minutes plus a minute), and every request asks it. So logout, "sign out that device", password change and reuse detection take effect at once, not up to 15 minutes later. **Fail-open:** if Redis is down, rate limits and this list are skipped (an error is logged and reported) so a Redis outage cannot lock every shop out of its POS. The cost is that during an outage a revoked session's access token can live out its 15 minutes and lockouts are not applied. A disabled **user** still keeps a valid access token until it expires (their refresh fails at once); P1-2 will make the permission check re-read user status.

**Enumeration safety.** Signup, resend, forgot-password and login answer identically (status, code, text) for existing and unknown emails, and unknown emails run a full password-hash comparison before failing. Wrong-password counters and lockouts also apply to unknown emails, so the lockout cannot reveal which accounts exist. Known residual difference: a failed login for a real account writes one audit row, which takes a few milliseconds more than the unknown-email path; this is small next to the hashing time and is accepted.

**Lockout.** Four free wrong attempts, then 1, 2, 4, 8, 15 minutes (cap), per email (not per IP, so attackers cannot dodge it by changing address; capped so a stranger cannot lock an owner out for long). A successful sign-in or a password reset clears it.

**Browser refresh token.** httpOnly + `SameSite=Strict` cookie scoped to `/v1/auth`, plus the readable `dumbbill_csrf` cookie and a required `X-CSRF-Token` header (double submit). Web app and API must share a site (`COOKIE_DOMAIN`). Mobile clients send the token in the body and need no CSRF.

**Password storage.** Argon2id (64 MB, 3 passes in production; the app refuses to start in production below the OWASP floor), mixed first with a **versioned pepper**: the stored value is `v<version>:<argon2 hash>`; a login with an older pepper or weaker settings re-hashes transparently (`needsRehash`). Passwords are checked against a built-in common list, personal details and the Have I Been Pwned range API (k-anonymity; skipped, with a log line, if unreachable).

**Two-step login.** TOTP (RFC 6238, checked against the RFC's own test vectors), secret encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`), a used code cannot be replayed (the last accepted time step is stored and claimed atomically), eight single-use recovery codes stored as hashes and removed with one atomic SQL statement. Setup is two-step (`setup`, then `enable` after a correct code) so a mis-scanned code cannot lock someone out. Mandatory two-step for Super Admin comes with that role (Phase 4).

**Audit.** `audit_log` is a tenant table that is append-only for the app role, and a trigger refuses UPDATE and DELETE even for the owner. `app_grant_defaults()` re-applies the revoke each time a migration runs it, so a later migration cannot quietly reopen it (tested). **Not built yet:** the hash chain from security.md section 6 (tamper evidence across rows); it needs a concurrency design and is tracked for P1-6 hardening.

**Open points left for later phases.** Customer identity pool and `dumbbill_customer` role (Phase 3; the `aud` claim already separates them, tested). Permission checks and role presets (P1-2). Sessions of a disabled user are ended when P1-2 adds user management. An absolute maximum session age (the 30-day window is sliding) is not set; consider 90 days in P1-6.

