# ADR 003: Row-level security strategy (what is isolated, by what, and where the exceptions are)

- Status: Accepted (17 Oct 2026)
- Deciders: Owner, architect agent
- Related: **ADR 002** (the mechanism and how it is built), `docs/03-engineering/security.md` §1, §3, `docs/03-engineering/architecture.md` §4, §5

ADR 002 explains **how** row-level security (RLS) works with Prisma. This ADR records the **strategy**: which data is isolated in which way, who may bypass it, and what the rules are for each kind of table. Read ADR 002 first.

## 1. Context

Three kinds of people use Dumbbill, and they need different walls:
- **Staff of one business** (owner, manager, cashier): may see only their own business, and only the branches they are allowed.
- **Customers** (shoppers with one login across many shops): may see only their own account and, per shop, only their own membership and points.
- **Dumbbill itself** (super admin, background jobs): must sometimes act across businesses, but never silently.

## 2. Decision

Every table falls into exactly one of four classes. A new table must be placed in a class before it is merged, and the RLS audit test (`test/security/rls-coverage.spec.ts`) enforces it.

| Class | Examples | Rule |
|---|---|---|
| **A. Tenant table** | products, branches, invoices, stock_ledger, memberships | Has `tenant_id`. RLS enabled and forced, standard `tenant_isolation` policy (ADR 002). Used by staff requests and tenant-scoped jobs. |
| **B. Global reference table** | plans, gst_states, category_templates | No `tenant_id`, no RLS, read-only for the app role. Changed only by seeds or migrations. |
| **C. Global identity table** | customers | No `tenant_id` (a shopper belongs to many shops). **Never read directly by the staff API.** Reached by staff only through `memberships` (a class A table), and by the customer API through its own role (see 3). |
| **D. Platform table** | webhook_events, super-admin tables | Not tenant data. Accessed only by the platform code path (see 4), never by a normal tenant request. |

### Rules that apply to every class A table
1. **Branch scoping is NOT in RLS.** RLS isolates the business. Which branches a person may see is checked in the service layer (`BranchScopeGuard` and a query helper). Reason: branch rules depend on the user's permissions and change often; putting them in SQL would make policies slow to change and hard to test. The matching test is the permission matrix test.
2. **Cross-tenant lookups return 404, never 403.** Saying "forbidden" would confirm that the id exists in another business.
3. **Append-only tables** (`audit_log`, `stock_ledger`, `points_ledger`, finalised invoices) additionally have `UPDATE` and `DELETE` revoked from the app role, so even a bug cannot rewrite history.
4. **Unique indexes include `tenant_id`** unless a global rule is deliberate (for example one account per email). See ADR 002 §5.
5. **Composite foreign keys `(tenant_id, id)`** are added on sensitive relations (invoice to invoice line, ledger to product) so a row can never point at another business's row.

### Customers (class C)
- A separate database role, `dumbbill_customer`, is created when the customer app is built (Phase 3). It has **no access to tenant tables at all**, except through a small set of policies that let a customer read only rows tied to their own `customer_id` (their memberships, their points, the offers of shops they joined).
- Staff and customers use different token audiences (`aud`), different guards and different roles, so a customer token can never reach a staff route and the reverse.

### Platform and super-admin access (class D, and any cross-business action)
- Uses a **separate role and code path**, never the normal app role, and never by loosening a policy.
- Every use is **audited** with a reason, **time-boxed**, and visible to the affected business (security.md §1, "Insider").
- Background jobs that must run for one business use `tenantTx.runAs({ tenantId }, ...)`. Jobs that must run across all businesses (for example a nightly summary) loop over tenants and run each one under its own tenant, rather than using a bypass.
- **Login by email** (before the tenant is known) uses the narrow `SECURITY DEFINER` function described in ADR 002, returning only what login needs.

### Production roles
- Development uses a superuser owner, which bypasses RLS. That is why the API and tests connect as `dumbbill_app`.
- In production the owner/migrator role must be a normal non-superuser role, the API connects only as `dumbbill_app`, and a startup check refuses to run if the API connection can bypass RLS (to be added with deployment work).

## 3. Consequences

Good:
- One short rule per kind of table; nobody has to decide isolation from scratch.
- The riskiest table (`customers`, shared across shops) is never exposed to staff queries.
- Every bypass is a separate, named, audited path that can be searched for in code.

Costs and caveats:
- Branch isolation is a service-layer rule, so a missing branch check would leak between branches **of the same business** (not between businesses). Mitigation: the permission matrix test and reviewer checklist.
- A second database role (`dumbbill_customer`) means a second connection pool and more setup in Phase 3.
- The class decision must be made for every table; the audit test makes forgetting impossible but does not decide for you.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Branch scoping inside RLS policies | Slower to change, hard to test per permission, and policies would need user and branch settings on every request. |
| Customers as tenant rows (a copy per shop) | One shopper would need a separate login for every shop, which breaks the single-login promise. |
| A super-admin role that bypasses RLS | One leaked credential would expose every business. Chosen instead: audited, time-boxed, separate path. |

## 5. How we know it works

- The ADR 002 tests (isolation, coverage audit, lint rule) already cover class A.
- To add when built: a test that the `dumbbill_customer` role cannot read any tenant table directly; a test that the permission matrix covers branch scope; a test that super-admin access writes an audit row.
