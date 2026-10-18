# ADR 001: One modular monolith, not microservices

- Status: Accepted (17 Oct 2026)
- Deciders: Owner, architect agent
- Related: `docs/03-engineering/architecture.md` §1, §3, §11

## 1. Context

Dumbbill is built and run by a very small team (today: one owner working with AI). It must be correct about money, stock and tax before it is clever about scale. It starts local-only and will later run on a small, cheap server (about US$150/month target).

Splitting a system into many separately deployed services makes sense when different parts need to scale or be owned separately. We have neither problem. We do have a real risk: a sale touches stock, invoice, payment, tax, loyalty and audit, and all of that must succeed or fail **together**.

## 2. Decision

1. **One NestJS application** (`dumbbill-backend`) organised as **modules** (auth, tenants, branches, products, pricing, suppliers, purchases, inventory, pos, tax, loyalty, reports, billing, notifications, files, audit, admin, health).
2. **One database transaction can span modules.** A checkout writes the stock ledger, invoice, payments, loyalty points and audit row in one transaction (architecture §7). This is the main reason we do not split.
3. **Modules talk through service interfaces only.** A module never reads or writes another module's tables directly. This keeps the option of splitting later cheap.
4. **Background work runs in the same codebase** as a separate process type (a BullMQ worker started from the same code), so PDFs, exports, digests and webhooks do not slow requests. Same code, two ways to start it.
5. **Web and mobile are separate apps** that talk to the backend only through its documented HTTP API (the OpenAPI/Swagger contract). They never share code with the backend.

## 3. Consequences

Good:
- Simple to run, debug and deploy: one thing to start, one log stream, one place a request can fail.
- Transactions across modules are ordinary database transactions; no distributed-transaction or "saga" complexity for money.
- Cheap to host: one small server process plus the database and Redis.

Costs and caveats:
- A bug or memory leak in one module can affect the whole API. Mitigation: the worker is a separate process, and load tests come before launch.
- Discipline is needed to keep module boundaries clean, because nothing in the runtime forces it. Mitigation: the "no cross-module table access" rule is part of code review (`reviewer` agent) and `dumbbill-backend/CLAUDE.md`.
- One deployable means one release for every backend change. Acceptable for a product with one team.

## 4. Alternatives considered

| Option | Why not |
|---|---|
| Microservices from day one | Distributed transactions for every sale, many deployables to run and monitor, far more cost and operations work than a small team can carry. |
| One big unstructured app | Hard to reason about and impossible to split later. Modules cost almost nothing and keep the door open. |
| Serverless functions | Awkward with long database transactions, background queues and tenant-scoped connections. Cold starts hurt POS speed. |

## 5. When to revisit

Split a module out only on **proven** need, for example: one module needs very different scaling (heavy report generation), or a part needs a separate team or compliance boundary. First step would be moving the worker process onto its own server, which the design already allows.
