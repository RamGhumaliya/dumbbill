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
