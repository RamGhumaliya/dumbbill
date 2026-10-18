# Runbook: Rotating secrets

> **Status: skeleton.** The inventory lists the secrets that exist **today** (local development) and the ones that will exist when features are built. Rotation steps for production are filled in when hosting is chosen. Principle: no secret ever lives in code, logs or git (hard rule 8); real `.env*` files are git-ignored, only `.example` templates are committed.

## When to rotate
- **Immediately** if a secret was committed, pasted in chat or a ticket, printed in a log, or a laptop or account was lost or compromised.
- When a person who knew it leaves.
- On a schedule (suggested: every 6–12 months, and keys that sign tokens at least yearly).
- After any incident where a secret might have been read.

If a secret leaked, **rotate first, investigate after.** Deleting a commit from git does **not** make a leaked secret safe; assume it was copied.

## Inventory

| Secret | Where it is used | Exists now? | Who can change it | Rotation impact |
|---|---|---|---|---|
| `DATABASE_URL` (owner/migrator password) | Migrations, seeds, role setup | Yes (dev: `dumbbill/dumbbill`) | Owner of the database | Tools only; no user impact |
| `APP_DATABASE_URL` (`dumbbill_app` password) | The running API | Yes (dev: `dumbbill_app/dumbbill_app`) | Owner of the database | API restart needed |
| `REDIS_URL` | Queues, rate limits, cache | Yes (no password in dev) | Owner | API and worker restart |
| `SENTRY_DSN` | Error reporting | Optional | Sentry project settings | Low risk (write-only), but rotate if abused |
| `JWT_PRIVATE_KEY` + `JWT_KEY_ID` (signs access tokens) | Access tokens | **Yes (P1-1)** | Owner | Rotation without logging anyone out: generate a new key (`pnpm keys:generate`), put the OLD public key in `JWT_PREVIOUS_PUBLIC_KEYS` as `oldkid:base64(public PEM)`, switch `JWT_PRIVATE_KEY` and `JWT_KEY_ID` to the new ones, deploy. After 15 minutes remove the old entry |
| `PASSWORD_PEPPERS` (versioned pepper) | Mixed into passwords before hashing | **Yes (P1-1)** | Owner | **Never replace the only entry**: existing passwords would stop working. ADD a higher version (`1:old,2:new`). New passwords use the highest; people with an old one are re-hashed automatically at their next sign-in. Remove the old version only when no active user still has it (a query on `users.password_hash LIKE 'v1:%'` tells you) |
| `DATA_ENCRYPTION_KEY` | Encrypts authenticator-app (TOTP) secrets | **Yes (P1-1)** | Owner | Changing it makes every stored TOTP secret unreadable (those people are asked to set up two-step login again, using recovery codes). Plan a re-encryption step before rotating it |
| `MAIL_SMTP_URL` | Sends email (Mailpit in dev, SES SMTP in production) | **Yes (P1-1)** | Cloud console | API restart |
| Refresh tokens | Sessions | Yes (P1-1) | n/a | They are random values stored only as hashes; there is no key to rotate. To sign everyone out, set `revoked_at` on all sessions (a deliberate, audited action) |
| Razorpay key id/secret and **webhook secret** | Billing | Planned Phase 4 | Razorpay dashboard | Update both sides in a short window; verify a test event |
| SES / SMTP credentials | Email | Planned | Cloud console | API/worker restart |
| FCM service account | Push notifications | Planned | Firebase console | Worker restart |
| Mobile signing keystore + passwords | Android release signing | Planned (manual release) | Owner only | **Losing it blocks app updates.** Keep an offline backup; never commit (`*.jks`, `key.properties` are git-ignored) |
| Apple signing certificates / API key | iOS release | Planned | Owner only | Via Apple developer account |
| Cloud (AWS) access keys / roles | Deployment | Deferred | Owner | Prefer roles over long-lived keys |

## Local development (today)

The dev passwords are public in `.env.example` and only protect your own machine. To change them:
**App role (`dumbbill_app`):** put the new password in `APP_DATABASE_URL` in `.env`, run `pnpm db:roles` (the script sets the role's password from that URL and re-asserts `NOSUPERUSER NOBYPASSRLS`), then restart the API and check `/readyz`.

**Owner role (`dumbbill`):** the Postgres volume keeps the password it was created with, so editing `docker-compose.yml` alone changes nothing. Change it in the database, then update `.env`:
```bash
docker compose exec -T postgres psql -U dumbbill -d postgres -c "ALTER ROLE dumbbill PASSWORD 'new-password'"
```
Update `DATABASE_URL` in `.env` to match and restart the API. Run `pnpm db:status` to confirm the owner connection works.

## Production (fill in when hosting is chosen)

### General procedure for any secret
1. **Generate** the new value with a secure generator (never invent one by hand, never reuse).
2. **Store** it in the secret manager (TO FILL: which one), not in files or chat.
3. **Deploy** it so old and new both work where possible (keys and webhook secrets support overlap); otherwise plan a short maintenance window.
4. **Verify** with `/readyz`, a test login, a test webhook, a test email, whichever applies.
5. **Revoke** the old value at the source.
6. **Record** it in the log below (what, when, why, who). Never record the value.

### Specific notes
- **Database passwords:** change in the database first, then the secret manager, then restart the API. The API role must stay `NOSUPERUSER NOBYPASSRLS` (ADR 002); `pnpm db:roles` re-asserts this.
- **JWT keys:** publish the new `kid`, switch signing to it, keep the old one for verification for at least the access-token lifetime plus a margin, then remove.
- **Pepper:** versioned, see the table.
- **Leaked in git:** rotate, then (optional, for hygiene) remove from history. Check whether the secret was ever used from an unknown place (provider logs).
- **Customer-visible effect:** rotating token or cookie secrets signs users out; tell businesses in advance when possible.

## Rotation log
| Date | Secret | Reason | By | Verified how |
|---|---|---|---|---|
| (none yet) | | | | |
