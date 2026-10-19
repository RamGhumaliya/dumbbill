# ADR 010: Business profile, GSTIN and branches

- Status: Accepted (19 Oct 2026, implemented in P1-3)
- Deciders: Owner, architect agent
- Related: ADR 003 (RLS strategy), ADR 009 (roles and permissions), user story US-BR-01, journey J1 (`docs/01-product/user-journeys.md`), `docs/api/business-and-branches.md`

## 1. Context

Every invoice must show the seller's name, address, state and (for a GST-registered shop) GSTIN. The seller's **state** decides the tax: a sale to a customer in the same state is charged CGST + SGST; to another state, IGST. A shop with several branches may have a different state, a different GSTIN and a different receipt printer in each, and invoice numbers must not clash between branches. The plan limits how many branches a business may run.

## 2. Decision

### The business profile

1. **The profile lives on the `tenants` row** (name, GSTIN, state code, address, city, PIN code, phone, logo). It is replaced as a whole (`PUT /v1/business`), so the screen always saves a consistent set.
2. **State is required, GSTIN is optional.** A shop that is not registered for GST has no GSTIN and can only issue bills of supply (no tax). The screen warns about this instead of blocking sign-up (journey J1).
3. **A GSTIN is checked three ways** before it is stored: its shape (2-digit state, 5 letters, 4 digits, a letter, an entity character, the letter Z, a check character), its **check character** (the official mod-36 weighted sum; it catches a single mistyped character), and that its first two digits **equal the chosen state**. The check lives in one pure function (`domain/gstin.ts`) with unit tests. The shape and the state match are also enforced by `CHECK` constraints in the database, so no code path can store a malformed number.
4. **We do not look the number up on the GST portal.** That needs a government API and a network call at sign-up; a typo-proof number is enough for now. A portal lookup can be added later behind the same function.
5. **A GSTIN is not unique across businesses.** A uniqueness index would span tenants, leak "this GSTIN is already registered here" to strangers, and block a rightful owner whose number someone else typed first. Disputes are a support matter.
6. **The logo is a file on the server's disk** (`docs/runbooks/file-storage.md`), saved under the business's own folder with a random name, as PNG, JPEG or WebP, at most 2 MB. The storage layer checks the file's first bytes, not just its name. Browsers fetch it with their sign-in token and show it from memory.

### Branches

7. **A branch has its own place and printer settings:** name, invoice prefix, receipt paper width (58 or 80 mm), state, optional GSTIN, address, city, PIN code, phone. Row-level security keeps businesses apart; a person's branch scope (ADR 009) decides which branches of their own business they see.
8. **Invoice prefixes are unique inside a business, not across businesses.** 1 to 6 capital letters or digits (`KOT` gives numbers like `KOT-000123`). Names are unique inside a business too. The service checks first, to name the exact field; the unique index in the database still stops two simultaneous requests.
9. **All GSTINs of one business share one PAN** (characters 3 to 12 of the number). A branch GSTIN with a different PAN is refused, and a new business GSTIN whose PAN disagrees with a branch is refused, because one legal entity has one PAN. (A shop that really is two legal entities should be two businesses.)
10. **The plan limits active branches.** Creating or switching a branch on at the limit answers `PLAN_LIMIT_REACHED`. Switched-off branches do not count. The limit is read from the plan (`maxBranches`: Starter 1, Growth 3, Pro 10; a trial uses Starter), so billing (Phase 4) only has to change a business's plan.
11. **Branches are switched off, never deleted**, because invoices and stock will refer to them. The **last active branch cannot be switched off**, so sales always have somewhere to happen.
12. **Sign-up creates one branch** ("Main branch", prefix `MAIN`) so a business is never without one; the owner edits it during onboarding.
13. **The invoice prefix will be locked once the branch has issued an invoice** (printed invoice numbers must never change). There are no invoices yet; the rule is noted in the service and becomes a check in Phase 2.

### Who may do what

14. **Reading** the profile, the GST state list and the permitted branches needs only a login (the till prints the name and address; a cashier needs their own branch's printer width). **Changing** anything, and the first-steps checklist, needs `settings.manage` (owner only by default).
15. **Everything is audited**, with the names of the fields that changed (never their values): `business.profile_updated`, `business.logo_changed`, `business.logo_removed`, `branch.created`, `branch.updated`, `branch.deactivated`, `branch.activated`.

### First-steps checklist

16. **Steps turn done by real data**, computed by the server (`GET /v1/business/onboarding`): profile (state, address, city, PIN code present), branch (an active branch with state and address), team (a second person). More steps (products, supplier, first purchase, test bill) are added by the modules that build them. The home screen shows the list to people with `settings.manage`, and shrinks it to one line when everything is done. The team step has no link yet because the team screens are not built.

## 3. Consequences

Good:
- One place decides what a valid GSTIN is, and the database refuses a malformed one whatever code writes it.
- Tax logic (Phase 2) can rely on every business having a state, and every branch a state and a prefix.
- A cashier can never change business details; the API refuses it (tested for every route).

Costs and caveats:
- **No portal verification.** A well-formed, correctly checksummed GSTIN can still be made up. Do not treat it as proof of registration.
- **PAN rule can reject a legitimate edge case** (a branch operated under another entity's registration). The message says what to do; the alternative (no rule) lets typos through.
- **The migration lifts and restores `FORCE ROW LEVEL SECURITY` on `branches`** for its backfill (existing branches get prefixes `B1`, `B2`, ...), restored in the same transaction.
- **Existing branches have no state or address** until the owner edits them; the checklist's branch step is the nudge.
- **Not built (later):** portal lookup, prefix lock after the first invoice, per-branch opening hours, branch-level tax registrations beyond one GSTIN, the team screens.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Unique GSTIN across all businesses | Leaks which GSTINs are customers; blocks the rightful owner if someone else registered it first. |
| Verify GSTIN against the GST portal at sign-up | Needs a government API, credentials and uptime; a typo check catches the real-world mistake. |
| Prefix per business (one for all branches) | Two branches would number invoices from the same series and race; separate series per branch is simpler and legal. |
| Delete branches | Invoices and stock must keep pointing at them; switching off keeps history. |
| Make GSTIN required | Many small shops are unregistered; blocking them blocks sign-up. A warning is honest and enough. |
| Store the logo as a public URL | The logo is business data; streaming it through the API with the login keeps it private and removes a public file listing. |

## 5. How we know it works

- `test/unit/gstin.spec.ts`: the published example's check character, any single mistyped character is caught, messy input (lower case, spaces) is accepted, wrong shapes are refused.
- `test/integration/business-flow.spec.ts` (27 scenarios): profile save and read-back, no GSTIN allowed, pasted GSTIN cleaned, check-character / state-mismatch / unknown-state refusals, fields a client must never set, cashier read-only, branch lifecycle with audit, plan limit, unique prefix and name per business, prefix tidying, 58/80 only, branch GSTIN rules, PAN contradiction in both directions, last-branch protection, switching on beyond the limit, branch scope for a cashier, 404 for another business's branches, the checklist turning done step by step, logo upload / download / removal, a script renamed to `.png` refused, over-size refused, permissions and isolation for the logo.
- `test/integration/permission-matrix.spec.ts` (generated from the real routes) and `swagger-completeness.spec.ts` cover the 13 new routes automatically.
- `test/security/business-db-security.spec.ts`: the database refuses a bad prefix, receipt width, state, GSTIN shape or state mismatch, PIN code and phone, and a repeated prefix in one business but accepts it in another.
- Web: 29 browser tests (real Chromium, pretend API) including axe in both themes on the four screens; unit tests for the multipart/blob client and for conflict field errors.
- A sabotage check (breaking each protection in turn) confirmed the tests detect: the check character skipped, the plan limit ignored, the profile open to any signed-in person, the branch list and single-branch read ignoring branch scope, the last active branch switched off, a branch GSTIN with a different PAN, and the duplicate prefix not being checked.
- A live run with real PostgreSQL, Redis, Mailpit and a real browser: wrong GSTIN explained under the box, a messy correct one saved clean, a real PNG uploaded and shown back, the plan-full state, a branch edited, a clashing prefix refused, switching off with confirmation, the last branch protected, the checklist advancing, a cashier refused with 403 but able to read the profile, and the audit trail.
