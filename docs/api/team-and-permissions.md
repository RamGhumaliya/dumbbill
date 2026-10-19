# Team and permissions (for web and mobile developers)

Guide to the **Team & Permissions** section of the API (the Swagger page at `/docs` lists every field). Why it is built this way: `docs/adr/009-roles-and-permissions.md`. Sign-in itself: `docs/api/auth-flow.md`.

## The idea in one minute

- Everything a person may do is a **permission**, named like `invoice.refund`. The full list, with plain-English labels, comes from `GET /v1/team/options` (`permissions[]`).
- A **role** (Owner, Admin, Cashier, or one the business made) is a named bundle of permissions. Owners can edit them.
- A person's **access** = their role's permissions + extras granted to them - permissions taken away. The **owner** always holds everything.
- **The server decides.** Hide or disable buttons using the access you were given, but always handle `403`: the API refuses anything the person may not do, whatever the screen shows.
- Changes are **immediate**. If an owner removes a permission or switches someone off, that person's very next request is refused, with the same access token.

## What can this person do? (use it to show or hide things)

`POST /v1/auth/login` and `GET /v1/auth/me` both return an `access` object:

```json
{
  "access": {
    "roleName": "Cashier",
    "permissions": ["products.read", "pos.sell", "discount.apply"],
    "discountLimitBp": 500,
    "allBranches": false,
    "branchIds": ["0192a3b4-3333-7e8f-9a0b-1c2d3e4f5a6b"]
  }
}
```

- `permissions`: show a screen or button only if the key is present (`products.cost.read` for cost columns, `invoice.refund` for the refund button...).
- `discountLimitBp`: the biggest discount this person may give alone, in **basis points** (500 = 5%). Above it, ask for a manager's PIN (see below).
- `allBranches` / `branchIds`: which branches they may use. When `allBranches` is true, `branchIds` is empty and means "all".
- Access can change while the app is open. **Refresh it** (`GET /v1/auth/me`) when the app comes to the foreground, and whenever a call answers `403`.

## Errors you will meet

| Code | Status | What to do |
|---|---|---|
| `FORBIDDEN` | 403 | "You do not have permission". Hide the action, and refresh `/me` (the person's access may have changed). `detail` explains rule refusals, for example *You can only grant permissions you hold yourself. Missing: reports.profit.* |
| `UNAUTHENTICATED` | 401 | Not signed in, or **switched off**. Try one token refresh, then the login screen. |
| `PLAN_LIMIT_REACHED` | 422 | Show `detail` (all seats used) and, later, an upgrade button. |
| `INVALID_PIN` | 422 | "That PIN is not valid". The same answer for a wrong PIN, no PIN, or a person who cannot approve. |
| `RATE_LIMITED` | 429 | Too many wrong PIN tries or invitations. Wait `Retry-After` seconds. |
| `CONFLICT` | 409 | Invitation: "This email address cannot be invited" (the answer never says why). Role: name already used, or the role still has people. |
| `NOT_FOUND` | 404 | The role, person or branch does not exist, **or belongs to another business** (the two look identical on purpose). |

## Managing the team (permission `team.manage`)

The owner always has it. Others only if the owner granted it.

```
GET    /v1/team/options                       roles, branches, permission catalogue, seats (one call for the forms)
GET    /v1/team/roles          POST /v1/team/roles
PATCH  /v1/team/roles/{roleId} DELETE /v1/team/roles/{roleId}
GET    /v1/team/members        GET /v1/team/members/{memberId}
POST   /v1/team/members                       invite
PATCH  /v1/team/members/{memberId}            change role, extras, taken-away, branches, discount limit
POST   /v1/team/members/{memberId}/disable    switch off (sessions end at once)
POST   /v1/team/members/{memberId}/enable     switch back on (needs a free seat)
POST   /v1/team/members/{memberId}/resend-invitation
```

Rules the API enforces (show them as plain-English hints, do not re-implement them):

- **No escalation.** A person can only grant permissions they hold, a discount limit no bigger than their own, and "all branches" only if they have it. The owner can grant anything.
- **Nobody changes their own role or permissions or switches themselves off.** Nobody except the owner changes the owner; the owner cannot be switched off.
- **The Owner role is locked.** The built-in Admin and Cashier roles keep their names and cannot be deleted; their permissions, discount limit and branch rule can be edited.
- Permissions must come from the catalogue: an unknown key is a `400 VALIDATION_FAILED`.
- The person's **effective access** is returned on each member as `effective` (permissions, discount limit, all-branches), so the screen can show "what they can really do".

### Inviting someone

1. `POST /v1/team/members` with `{ email, fullName, roleId, branchIds?, extraPermissions?, deniedPermissions?, discountLimitBp? }`. The person appears with `status: "INVITED"` and gets an email.
2. The email link opens **`<WEB_BASE_URL>/accept-invitation?token=...`**. That page asks for a password and calls `POST /v1/auth/accept-invitation { token, password }` (public). Password rules are the same as sign-up; a refused password (`422 WEAK_PASSWORD`, reasons in `errors[]`) does **not** use up the link.
3. The link works once and for 7 days. Resend with `POST .../resend-invitation` (older links stop working).
4. After accepting, the person is `ACTIVE` with a confirmed email and can sign in.

Switching someone off before they accept retires their link; switching them back on returns them to `INVITED` and needs a new link.

## Branches

A person works in all branches (`allBranches: true`) or only the assigned ones (`branchIds`). Send `branchIds` (the **full** new list) when updating a member. Branch ids come from `GET /v1/team/options` (`branches[]`). Later modules (stock, sales) filter by the person's branches on the server; the app should only offer the branches in `access`.

## The approval PIN (discounts at the till)

A cashier may only give discounts up to their `discountLimitBp`. For more, a manager types **their own 6-digit PIN** at the till: no sign-out, and the system records who approved.

- **Set your PIN:** `PUT /v1/auth/pin { currentPassword, pin }`. Needs the password. Obvious PINs (`123456`, `000000`, repeated digits) are refused with `400` and a reason in `errors[]`. Remove it: `POST /v1/auth/pin/clear { currentPassword }`.
- **At the till (permission `pos.sell`):**
  1. `GET /v1/team/approvers` lists active people who may approve and have a PIN.
  2. The cashier picks one; the approver types their PIN on the cashier's device.
  3. `POST /v1/team/approvals/verify-pin { approverUserId, pin }` answers `200 { approver }` or `422 INVALID_PIN`.
- After 5 wrong tries the PIN is locked **for that cashier** (1 minute, doubling; `429` with `Retry-After`). Other cashiers are not affected.
- Never store or log a PIN. Send it once and drop it.
- (The signed approval token that ties a PIN to one specific bill arrives with the checkout, Phase 2.)

## Things that surprise people

- A `403` does not always mean "never": the owner may change the role a moment later. Refresh `/me`.
- `NOT_FOUND` for another business's role or person is deliberate; never say "that belongs to someone else".
- A person's **access token** keeps its 15 minutes, but their **permissions are re-read on every request**, so an old token never carries old powers.
- Counting seats: invited and active people count; switched-off people do not.
