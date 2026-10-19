# Manual testing: Phase 1 (sign-in, team, business and branches)

A hands-on checklist for stories P1-1 (auth), P1-2 (roles, permissions, team) and P1-3 (business profile, GSTIN, branches). The automated tests cover the same flows (`pnpm test:all` in each app); this guide is for seeing it with your own eyes. Run the commands in Git Bash or PowerShell.

## 0. Setup

```bash
# Terminal 1: backend
cd dumbbill-backend
docker compose up -d        # Docker Desktop must be running
pnpm db:reset               # rebuilds the LOCAL database from the migrations (local data only, never on a server)
pnpm db:seed                # plans, GST states, category templates
pnpm dev                    # API on http://localhost:3000

# Terminal 2: web
cd dumbbill-web
pnpm dev                    # web on http://localhost:3001
```

| What | Address |
|---|---|
| Web app | http://localhost:3001 |
| Swagger (API manual, can call routes) | http://localhost:3000/docs |
| Mailpit (every email the app sends) | http://localhost:8025 |

Check: `curl localhost:3000/readyz` answers `"database":"up"`. Rate limits can be switched off for testing with `RATE_LIMIT_DISABLED=true` in `dumbbill-backend/.env` (development only; production refuses to start with it).

**Port 3000 already in use** (`EADDRINUSE`): an older API is still running. Find and stop it:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
Stop-Process -Id <that number> -Force
```

Then run `pnpm dev` again. The same applies to port 3001 for the web app.

## 1. P1-1: sign up and sign in (web)

1. `/signup`: business name, your name, an email such as `owner@test.com`, a strong password. You see a "check your email" screen.
2. Open Mailpit, click the confirmation link, then sign in at `/login`. You land on "Owner dashboard".
3. Try:
   - A wrong password gives a generic message that never says whether the email exists.
   - Signing up again with the same email looks identical (it never says "already registered").
   - Reload the page: you stay signed in.
   - Sign out from the menu, then open `/branches`: you are sent to `/login`.
   - "Forgot password": read the reset email in Mailpit.
   - `/account/security`: change the password, switch on two-step sign-in (an authenticator app), see your devices.

## 2. P1-2: roles, team and permissions

There are no team screens yet, so use Swagger (`/docs`).

1. `POST /v1/auth/login` with `{"email":"owner@test.com","password":"...","clientType":"MOBILE"}`. Copy `accessToken`, click **Authorize** (top right) and paste it.
2. `GET /v1/team/options`. Copy the Cashier role's `id`.
3. `POST /v1/team/members` with `{"email":"cashier@test.com","fullName":"Asha Patil","roleId":"<cashier id>"}`.
4. In Mailpit open the invitation and click the link (`/accept-invitation`). Try a weak password first (refused; the link is not used up), then a strong one. Sign in as the cashier.
5. Check the permissions:
   - With the cashier's token, `GET /v1/team/members` answers **403**, and so does `PUT /v1/business`.
   - As the owner, `PATCH /v1/team/roles/<cashier role id>` with `{"permissions":["products.read"]}`. The cashier's same token loses the removed permission on its next call.
   - As the owner, `POST /v1/team/members/<id>/disable`. The cashier's browser is cut off at once.
6. Starter allows 3 people. A fourth invitation answers `PLAN_LIMIT_REACHED`.

## 3. P1-3: business profile, branches, checklist (web, as the owner)

1. **Dashboard:** "Set up your shop", 0 of 3 done.
2. **Business profile** (menu):
   - State Maharashtra, GSTIN `27AAPFU0939F1ZW`: refused with a "typing mistake" message under the box.
   - GSTIN `27AAPFU0939F1ZV`: saves. A messy `27 aapfu 0939 f1zv` is cleaned on save.
   - GSTIN empty: a warning that only bills of supply can be issued.
   - State Karnataka with the Maharashtra GSTIN: refused (state does not match).
   - Fill address, city, PIN code. Upload a PNG logo. A `.txt` file is refused by the browser; a text file renamed to `.png` is refused by the server.
3. **Branches:** the Starter plan allows 1 branch, so "Add a branch" is hidden and a "plan is full" note shows.
   - Edit "Main branch": new name, prefix `KOT`, state, address, paper width 58.
   - To test adding more, move the business to the Growth plan (3 branches), then reload `/branches`:

     ```bash
     cd dumbbill-backend
     docker compose exec postgres psql -U dumbbill -d dumbbill -c "update tenants set plan_id=(select id from plans where code='GROWTH')"
     ```
   - Add a second branch with prefix `KOT`: refused under the prefix box. Use `BAN`.
   - Switch the second branch off (a confirm dialog appears), then try to switch off the last active one: refused.
4. **Dashboard:** profile and branch show done. The team step says "Screen coming soon".
5. **Cashier view** (private window): Branches shows only their branch with no buttons, and "Business profile" is not in the menu.

## 4. Audit check

```bash
docker compose exec postgres psql -U dumbbill -d dumbbill -c "select created_at, action from audit_log order by created_at"
```

Expect entries such as `auth.login`, `team.member_invited`, `authz.denied`, `business.profile_updated`, `branch.created`, `branch.deactivated`.

## 5. If something looks wrong

Write down the page, what you did, and the reference code shown on any error (it finds the exact request in the API log). Common causes are in `docs/runbooks/troubleshooting.md`.
