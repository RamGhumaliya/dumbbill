# Sign-in and refresh flow (for web and mobile developers)

This is the integration guide for the **Auth** section of the API (`/docs` in Swagger lists every field). Why it is built this way: `docs/adr/006-auth-and-sessions.md`.

## The idea in one minute

- You sign in with email and password. You get a **15-minute access token**. Send it on every request: `Authorization: Bearer <accessToken>`.
- You also get a **refresh token** (30 days). It is used **once** to get a new access token *and a new refresh token*. The one you just used is dead.
- Browser apps never see the refresh token: it is an **httpOnly cookie**. Mobile apps keep it in secure storage (Keychain / Keystore).
- When the refresh fails with `INVALID_REFRESH_TOKEN`, the session is over. Clear everything and show the login screen.

## Sign-up and first sign-in

```
POST /v1/auth/signup          { businessName, ownerName, email, password }     -> 202 (always the same answer)
   (the owner opens the email)
POST /v1/auth/verify-email    { token }                                         -> 204
POST /v1/auth/login           { email, password, clientType: "WEB" | "MOBILE" } -> 200
```

- Signup answers **202 with the same text whether or not the email already has an account**. Never write UI that says "this email is taken": it cannot know, by design. Show "Check your inbox".
- The web page that handles the emailed link is `<WEB_BASE_URL>/verify-email?token=...`; it posts the token to `/v1/auth/verify-email`.
- Sign-in before verifying gives `403 EMAIL_NOT_VERIFIED`: show "Confirm your email" with a **Resend** button (`POST /v1/auth/resend-verification { email }`, always 202).

## Sign-in response

```json
{
  "accessToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresInSeconds": 900,
  "refreshToken": "0192a3b4-....<43 characters>",
  "user":   { "id": "...", "email": "ravi@fitfuel.in", "fullName": "Ravi Mehta", "isOwner": true, "totpEnabled": false },
  "tenant": { "id": "...", "name": "FitFuel Nutrition", "status": "TRIAL", "trialEndsAt": "2026-11-01T09:30:00.000Z" }
}
```

`refreshToken` is in the body **only for `clientType: "MOBILE"`**. For `WEB` it is set as a cookie instead and is absent from the JSON.

## Mobile (Flutter)

1. Sign in with `clientType: "MOBILE"`. Keep `accessToken` in memory and `refreshToken` in `flutter_secure_storage`.
2. Send `Authorization: Bearer <accessToken>`.
3. On `401 UNAUTHENTICATED`, call `POST /v1/auth/refresh { "refreshToken": "<stored>" }` **once**, store the NEW `refreshToken` from the answer **before** doing anything else, and retry the original request once.
4. If the refresh answers `401 INVALID_REFRESH_TOKEN`, delete both tokens and go to the login screen.
5. Sign out: `POST /v1/auth/logout { "refreshToken": "<stored>" }`, then delete both tokens.

The answer to a refresh has **no** `refreshToken` in one rare case: two refreshes ran at the same instant (for example from two parallel requests that both got a 401). Keep the token you have *if the answer has none*, and **serialise refreshes** (one at a time, other requests wait for it) so this does not happen. The mobile network layer (`core/network/interceptors.dart`) already shares one renewal between parallel calls; the real refresher that calls this endpoint replaces the placeholder (`auth_refresher.dart`) when the mobile login screens are built.

## Browser (Next.js)

1. Sign in with `clientType: "WEB"`, `credentials: "include"`. The answer sets two cookies:
   - `dumbbill_rt`: the refresh token. **httpOnly**, `SameSite=Strict`, `Secure` in production, path `/v1/auth`. JavaScript cannot read it.
   - `dumbbill_csrf`: a random value. **Readable** by JavaScript.
2. Keep `accessToken` **in memory only** (a variable or store). Never in `localStorage`, `sessionStorage` or a readable cookie.
3. After a page reload the access token is gone. Call `POST /v1/auth/refresh` (no body) with `credentials: "include"` and the header `X-CSRF-Token: <value of the dumbbill_csrf cookie>`. The answer has a new `accessToken`; the new refresh token arrives as a fresh cookie automatically.
4. Same for any `401`: refresh once, retry once.
5. Sign out: `POST /v1/auth/logout` with `credentials: "include"` and the `X-CSRF-Token` header.

**Why the CSRF header?** Browsers attach cookies to requests automatically, even ones started by a malicious website. `SameSite=Strict` already stops that; the header is a second lock. Another site can make your browser *send* the cookie but cannot *read* `dumbbill_csrf`, so it cannot fill the header. A refresh or logout through the cookie without a matching header answers `403 CSRF_FAILED`.

CORS: the API answers browsers only for the origins in `CORS_ALLOWED_ORIGINS`, with credentials. The web app and API must be on the same site (for example `app.dumbbill.in` and `api.dumbbill.in`, with `COOKIE_DOMAIN=.dumbbill.in`), because `SameSite=Strict` cookies are not sent between different sites.

## Two-step login (authenticator app)

```
POST /v1/auth/login { email, password, clientType }                  -> 401 TOTP_REQUIRED     (password was right)
POST /v1/auth/login { email, password, clientType, totpCode: "492039" } -> 200
POST /v1/auth/login { ..., recoveryCode: "K7F2M-9QXPA" }               -> 200     (phone lost; each code works once)
```

Switching it on: `POST /v1/auth/totp/setup` returns `secret` and `otpAuthUri` (render the URI as a QR code), then `POST /v1/auth/totp/enable { code }` confirms the first code and returns **8 recovery codes, shown once**. Ask the person to save them. Switching off needs the password and a code: `POST /v1/auth/totp/disable { password, code }`.

## Passwords

- `POST /v1/auth/forgot-password { email }` is always 202. The email contains `<WEB_BASE_URL>/reset-password?token=...` (works once, 30 minutes).
- `POST /v1/auth/reset-password { token, newPassword }` ends **every** session. Send the person to the login screen.
- `POST /v1/auth/change-password { currentPassword, newPassword }` ends the **other** sessions; this device stays signed in.
- Password rules: 10 to 128 characters, not common, not containing the person's name or email, not found in a known data breach. No symbol/capital rules. `422 WEAK_PASSWORD` carries the reason in `errors[]`: show it under the password field.

## Devices

- `GET /v1/auth/sessions`: the person's signed-in devices (`current: true` marks this one).
- `DELETE /v1/auth/sessions/{sessionId}`: sign one out. Its access token stops working at once.

## Error codes you will meet

| Code | Status | What to do |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | One generic message: "Email or password is incorrect". Never say which. |
| `EMAIL_NOT_VERIFIED` | 403 | "Confirm your email", offer Resend. |
| `TOTP_REQUIRED` | 401 | Show the code box, repeat the login with `totpCode`. |
| `INVALID_TOTP_CODE` | 401 | "That code is not right". |
| `RATE_LIMITED` | 429 | Read the `Retry-After` header (seconds) and show a countdown. After 5 wrong passwords the account is locked for 1 minute, doubling to a 15-minute maximum. |
| `INVALID_REFRESH_TOKEN` | 401 | Session over: clear tokens, go to login. |
| `UNAUTHENTICATED` | 401 | Try one refresh, then login. |
| `CSRF_FAILED` | 403 | Re-read the `dumbbill_csrf` cookie and retry once. |
| `INVALID_TOKEN` | 400 | The emailed link is used or expired: offer to send a new one. |
| `WEAK_PASSWORD` | 422 | Show `errors[]` under the password field. |

The full catalogue with UI hints is `docs/api/error-codes.md`.

## Things that surprise people

- A response can be **identical for an existing and a missing account** on purpose (signup, resend, forgot password, login errors). Do not try to "improve" the UX by revealing more.
- The access token keeps working for up to 15 minutes if a user is **disabled** (their refresh stops at once). Sensitive actions re-check the account on the server.
- Behind a proxy or CDN the API must be told how many proxies there are (`TRUST_PROXY_HOPS`), or every visitor looks like the same IP address and shares one rate limit.
