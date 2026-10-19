# ADR 009: Roles, permissions and the team

- Status: Accepted (19 Oct 2026, implemented in P1-2)
- Deciders: Owner, architect agent
- Related: `docs/03-engineering/security.md` section 3, ADR 003 (RLS strategy), ADR 006 (sign-in), user stories US-TEAM-01, US-SEC-03, US-SEC-04, `docs/api/team-and-permissions.md`

## 1. Context

A shop has several kinds of people: the owner, managers, cashiers. They must be able to do very different things: a cashier sells and gives small discounts but must **never** see what products cost or what the shop earns; a manager can approve bigger discounts; only the owner runs the team. Businesses differ, so the owner must be able to change who may do what without a developer.

The rule that matters most: **the server decides, always.** A hidden button in the app is a convenience; the API must refuse the action even if someone calls it directly (US-SEC-04).

## 2. Decision

### Permissions, roles and access

1. **One catalogue of permissions** (`src/modules/permissions/permissions.matrix.ts`), named `area.action` (`invoice.refund`). It is the single source for the guard, the role templates, the team screens, the Swagger check and the automatic tests. Adding a capability means adding one line there.
2. **Roles are editable bundles of permissions.** Every business starts with **Owner**, **Admin** and **Cashier**. Admin and Cashier can be edited (permissions, discount limit, branch rule); they keep their names and cannot be deleted. A business may add its own roles. **Owner is locked.**
3. **The owner always holds every permission**, including ones added in future, regardless of any role row. So no editing or deleting of roles can ever lock the owner out.
4. **A person's access = role + extras granted to them - permissions taken away.** "Taken away" wins over everything. This gives per-person fine control without creating a role for every exception.
5. **Code never asks "is this an admin?"** (`if (role === 'admin')` is banned, security.md section 3). It asks "does this person hold this permission?".
6. **Starting values** (decided with the product owner, editable per business): Cashier = view products, sell, give discounts, up to **5%**, assigned branches only. Admin = everything except managing the team and business settings, up to **20%**, all branches. A cashier-style role must never hold a *confidential* permission (`products.cost.read`, `reports.profit`); this is tested.

### Enforcement

7. **Deny by default, three declarations.** Every route must say exactly one of `@Public()`, `@Authenticated()` (any signed-in person, own account) or `@Permission('...')`. A global guard enforces it; a route that says nothing, or contradicts itself, is **refused for everyone, even the owner**, and a test fails the build.
8. **Access is loaded from the database on every protected request**, not read from the access token. A permission removed a second ago, a role edited, or a person switched off applies to the very next call, with the same token. (This also closes the P1-1 limit that a disabled person's access token lived up to 15 minutes.) The cost is one small query per request.
9. **Refusals are audited.** A 403 writes `authz.denied` (who, which route, which permission was missing, IP, request id) to the append-only audit log.
10. **The Swagger text must agree with the code**: every route's "Permission:" line is checked against what the route declares.

### Hand-out rules (no escalation)

11. **Nobody can grant what they do not hold.** A team manager can only give permissions they hold, a discount limit no bigger than their own, and "all branches" only if they have it. The owner is exempt. Only what is being *added* is checked; removing power is always allowed.
12. **Nobody changes their own access or switches themselves off**, and **nobody but the owner touches the owner** (and the owner cannot be switched off at all). There is exactly one owner per business for now; ownership transfer is a later feature.

### Team

13. **Invitations.** The owner or a manager adds a person (status INVITED) and an email with a 7-day, single-use link lets *that person* choose their own password; nobody else ever sets it. The link also confirms the address. A refused password does not use the link up. Resending replaces the older link. Switching someone off retires their pending links.
14. **Switching a person off is immediate**: all sessions end, access tokens stop working at once (revocation list), and the next request is refused. History is kept. Switching back on restores sign-in; old sessions stay ended.
15. **Plan limits.** Active and invited people count against the plan's user limit (Starter 3, Growth 10, Pro 30); switched-off people do not. Over the limit: `PLAN_LIMIT_REACHED`.
16. **One email, one account, product-wide.** Inviting an address that already has an account anywhere answers one generic "cannot be invited" for every reason, and invitations are rate limited (20 an hour per business). See consequences for the residual leak.

### Branches

17. **Row-level security separates businesses; branches of one business are separated in the application** (ADR 003). A person's *branch scope* is "all branches" (by role) or the list assigned to them. `BranchScope` (filter lists, assert one item) and `@BranchScoped({ param })` (refuse a request naming a branch outside the scope) are the tools later modules use. P1-2 adds only a **minimal `branches` table** (name, active) plus a default "Main branch" at signup so people can be assigned; P1-3 adds addresses, GST numbers and the screens.

### Approval PIN

18. **A 6-digit PIN lets a manager approve a discount at the till** with their own PIN, no sign-out needed. It is stored as a **peppered Argon2id hash** (like passwords). Because a PIN has only a million possibilities, protection comes from: the server-side pepper (a stolen database alone cannot be attacked offline), a **lockout per (approver, person trying)** (5 wrong tries, then 1 minute doubling) plus overall ceilings per approver and per address, refusal of obvious PINs (123456, 000000, repeats), and audit of every check.
19. **Checking a PIN never reveals anything**: wrong PIN, no PIN set, switched off, unknown person and "may not approve" all answer the same `INVALID_PIN`.

## 3. Consequences

Good:
- One place defines what a permission is; the guard, docs, screens and tests cannot drift.
- Forgetting to protect a route is impossible to ship (build fails; guard refuses).
- Changes apply instantly; disabling someone is truly immediate.
- The cashier-never-sees-cost promise is defended in three places: role preset (tested), the permission names flagged confidential, and (from P1-4) separate response types.

Costs and caveats:
- **One extra query per protected request.** Acceptable now; a short-lived cache could be added later, but it would make changes less immediate, so it needs a deliberate decision.
- **Invitations can reveal that an email has an account** (the inviter sees "cannot be invited"). They are rate limited and the inviter is an authenticated team manager, but a malicious owner could probe addresses slowly. Accepted; the alternative (always "sent") would hide real problems from honest owners.
- **A cashier can lock the approver's PIN only for themselves** (the lock is per approver and per person trying), so guessing cannot deny approvals to everyone else. A determined staff member can still burn their own attempts.
- **PIN strength depends on the pepper.** If both the database and the pepper leak, PINs can be recovered in seconds. Keep the pepper out of the database (it is an environment secret, see `rotate-secrets.md`).
- **The backfill migration lifts and restores `FORCE ROW LEVEL SECURITY` on `users` and `tenants`** for its duration, because a normal (non-superuser) table owner would otherwise see no rows. It restores it in the same transaction.
- **Permission presets in the backfill migration are a historical snapshot.** Later changes to presets reach new businesses only; existing businesses' roles are theirs to edit.
- **Not built (later):** transferring ownership, a second owner, device-bound PINs, per-branch permission differences, a tenant-wide discount policy (the effective limit will be the lower of role and policy, Phase 2), an audit-log viewer (US-AUD-01), team screens beyond the basics.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Fixed roles in code (`if admin`) | Businesses differ; every change would need a developer; the check is easy to get wrong in one place. |
| Put roles and permissions inside the access token | Fast, but changes would wait up to 15 minutes, and disabling someone would not be immediate. |
| Cache permissions per user | Same delay problem; deferred until measurement says it is needed. |
| Permissions only per role (no per-person extras/denials) | Forces a new role for each exception; owners would create dozens of near-duplicate roles. |
| Let team managers grant anything | One compromised or curious manager could promote themselves or a friend to owner-level power. |

## 5. How we know it works

- `test/unit/permissions.spec.ts`: the catalogue is well formed, the cashier preset has no confidential permission, access is computed correctly (taken away wins, unknown keys ignored, owner always everything), the no-escalation maths, branch scope, route declarations.
- `test/integration/team-flow.spec.ts` (37 scenarios): the invitation lifecycle, immediate effect of role and permission changes with the same token, switching off, owner protection, self-service and escalation attempts, plan limit, branch assignment, the PIN, isolation between businesses, audit entries.
- `test/integration/permission-matrix.spec.ts`: **generated from the real routes.** Calls every route as five callers and checks the answer equals the declared rule; a forgotten route is flagged and refused; Swagger agrees with the code.
- `test/security/team-db-security.spec.ts`: isolation of roles, branches and assignments in the database; value checks; one built-in role of each kind per business.
- A sabotage check (breaking each protection in turn) confirmed the tests detect: the guard letting everyone through, no escalation rule, owner not protected, self-editing allowed, no PIN lockout, plan limit ignored, switched-off people not checked, unprotected routes let through, a cashier preset with cost access, an editable Owner role. The check also exposed one gap, now closed: the per-request "is this person still active" check was not tested separately from session revocation, so a test now switches someone off directly in the database (no sessions ended) and expects the refusal.
