# Runbook: Handling an incident

> **Status: skeleton.** The process below is ready to follow. Contact details, the status page and on-call arrangements are blank until the product has real customers and hosting. Source policy: `docs/03-engineering/security.md` §9 and `docs/03-engineering/observability.md`.

An **incident** is anything where customers cannot sell, see wrong data, or their data may be exposed. When unsure, treat it as an incident and downgrade later.

## 1. Severity

| Level | Meaning | Examples | First response within |
|---|---|---|---|
| **SEV1** | Customers cannot sell, or data may be exposed, or money/tax figures are wrong | API down; one business seeing another's data; wrong GST on invoices; database lost | 15 minutes |
| **SEV2** | A major feature is broken, no data exposed, workaround exists | Reports wrong; offline sync stuck; printing failing for one model | 4 hours |
| **SEV3** | Minor feature broken or slow | One screen slow; wrong label | next working day |
| **SEV4** | Cosmetic or small request | Typo | backlog |

Any suspected **cross-business data exposure is SEV1**, whatever the scale.

## 2. First 15 minutes (SEV1/SEV2)

1. **Write down the time** you found out and how. Open a notes file (or a doc); everything goes in it with times.
2. **Find a request reference.** Users see "Reference: …" on errors. Search the logs and Sentry for that `requestId` (`docs/runbooks/logging-and-errors.md`).
3. **Check the basics:** is the API up (`/healthz`, `/readyz`)? Is the database reachable? Disk full? Was something deployed or migrated recently?
4. **Stop the damage.** If wrong data is being written, pause the cause: disable the feature (feature flag), stop the worker, or stop the API. A short outage is better than bad invoices.
5. **Do not delete or "tidy" anything yet.** Logs, the audit log and the database state are evidence. Keep them.

## 3. Common first moves

| Situation | First move |
|---|---|
| Bad deployment | Roll back (`rollback.md`) |
| Bad migration | Do **not** hand-edit tables. Stop the API, assess with `pnpm db:status`, restore if needed (`restore-db.md`) |
| Secret leaked (key, password, token, `.env` committed) | Rotate it now (`rotate-secrets.md`), then investigate use of it |
| Suspected data crossing between businesses | Take the API offline, preserve logs and the audit log, run the RLS coverage test, see section 5 |
| Webhook storm / queue backed up | Look at queue depth and the dead-letter queue; stop the producer; replay safely (events are idempotent) |
| Database full or slow | Check long-running transactions and connection count; stop heavy jobs (reports, exports) |

## 4. Communicate

- **Owner of Dumbbill** decides who is told and when. (Today the owner is the only responder: see `docs/README.md`, support model.)
- Message to affected businesses (keep it short and plain): what happened, what is affected, what we are doing, when the next update is, how to reach us. Do not guess causes or promise a time you cannot meet.
- Status page: TO FILL (none yet).

## 5. Data exposure or breach (SEV1)

India's Digital Personal Data Protection Act 2023 applies. The privacy design in `security.md` §7 says Dumbbill is the **processor** and each business is the **fiduciary** for its customers' data, and sets a **72-hour breach notification workflow**.

1. Record exactly what was exposed, to whom, from when to when. Use the audit log and request logs; do not guess.
2. Contain it (close the hole, rotate secrets, revoke sessions).
3. Tell affected businesses promptly so they can meet their own legal duties. TO FILL: the notification template and the legal contact (take legal advice before notifying a regulator).
4. Keep all evidence. Do not delete logs.

## 6. After the incident

- **Blameless write-up within 5 days:** timeline, cause, what worked, what did not, and actions with owners and dates. Keep it in `docs/incidents/YYYY-MM-DD-title.md` (create the folder at the first incident).
- Add a **test** that would have caught it (hard rule 9), and update the relevant runbook.
- If a control failed (RLS, permission, redaction), treat the fix as a security change: run the `security-auditor` review.

## 7. Contacts (fill in)

| Role | Name | Phone / email |
|---|---|---|
| Owner / primary responder | TO FILL | TO FILL |
| Backup responder | TO FILL | TO FILL |
| Hosting provider support | TO FILL (when chosen) | TO FILL |
| Chartered accountant (for tax-document problems) | TO FILL (open question 4) | TO FILL |
| Legal advice (for data breach) | TO FILL | TO FILL |
