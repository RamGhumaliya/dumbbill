# Runbook: Rolling back a release

> **Status: skeleton.** Production does not exist yet and deployment is deferred, so release mechanics are TO FILL. The **rules** below already apply to how code and migrations are written today, so that a rollback is possible when it is needed. There is **no staging environment** (only dev and prod): a rollback must be possible without rehearsal, which is why these rules are strict.

## The rules that make rollback possible (apply now)

1. **Migrations are backward compatible: expand, migrate, contract.**
   - *Expand:* add the new column/table (nullable or with a default). The **old** code must still work against the new schema.
   - *Migrate:* deploy the new code that writes both or reads the new place; backfill data.
   - *Contract:* remove the old column only in a **later** release, after the new code has been stable.
   - Never drop or rename a column in the same release that stops using it. This is what lets us put the old code back.
2. **Risky features ship behind a feature flag**, off by default, so they can be switched off in seconds without a deploy.
3. **Never edit an applied migration.** Fix forward with a new migration.
4. **Append-only data cannot be rolled back by editing** (invoices, stock ledger, audit log, points ledger). A wrong entry is corrected by a reversing entry. A rollback of code never deletes business records.
5. **Releases are small** (PRs ≤ 400 lines), so "what changed" is quick to answer.
6. **Each release records:** version/commit, migration names, feature flags touched. (TO FILL: where.)

## Decide: roll back, switch off, or fix forward?

| Situation | Best move |
|---|---|
| New feature misbehaves, flag exists | **Switch the flag off.** Fastest, no deploy |
| New code is broken, last migration was only "expand" | **Roll back the code** to the previous version; leave the schema |
| Migration itself is broken or lost data | Stop. Do not improvise. `incident.md`, then `restore-db.md` |
| Small clear bug, fix is quick and tested | **Fix forward** (new release), if the damage is not growing |
| Unsure | Roll back the code first if it is safe by the rules above; investigate afterwards |

## Steps (fill in when hosting is chosen)

### 1. Backend API and worker
1. Note the bad version and the last good version.
2. Check the migrations between them: were any "contract" steps (drops/renames) applied? If yes, a code rollback may not work; go to the incident runbook.
3. Redeploy the previous version (TO FILL: command or console steps).
4. Verify: `/healthz`, `/readyz`, a test login, a test checkout in the test business, queue depth normal, error rate normal in Sentry.
5. Record the rollback.

### 2. Web app
TO FILL (hosting-dependent). Rule: the web app and API stay compatible across **one** release in each direction, so either can be rolled back alone.

### 3. Mobile apps (manual release)
A shipped app version cannot be pulled back from phones. Instead:
- **Min-version gate:** the API exposes a minimum supported app version (`/v1/meta`, architecture §9); raise it to force an update, or keep the API compatible with older versions.
- **Feature flags** switch off a broken feature remotely.
- Staged rollout (Play Console) is used so a bad build reaches few users first; halt the rollout if crash-free sessions drop under 99.5%.
- Publish a fixed build as soon as possible.
- TO FILL: store-specific steps when the developer accounts exist.

### 4. Database
Roll back **code**, not the database, whenever possible. Restore is a last resort (`restore-db.md`) and loses data written since the backup point.

## After a rollback
- [ ] Customers informed if they were affected (`incident.md`).
- [ ] The cause is understood; a test is added that fails on the bad change.
- [ ] The release notes record that this version was rolled back and why.
