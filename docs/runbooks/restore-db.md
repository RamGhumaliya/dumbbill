# Runbook: Back up and restore the database

> **Status: skeleton.** Part A (local) is tested and usable today. Part B (production) is filled in when hosting is chosen, because the steps depend on the provider. Targets from `docs/03-engineering/security.md` §4: **RPO ≤ 5 minutes** (we lose at most 5 minutes of data) and a restore **drill every quarter**.

## When to use this
- A bad migration or a bug damaged data and you must go back to an earlier state.
- A server or disk was lost.
- You want to copy a database to check a restore works (the quarterly drill).
- Before any risky change on your own machine.

**Never restore over the live database as a first step.** Restore into a new, empty database, check it, then switch over. Because there is no staging environment (only dev and prod), this scratch-database habit is how we rehearse.

## A. Local (dev) backup and restore

Run from `dumbbill-backend` with the Docker services up. The commands use `sh -c` so paths inside the container are not rewritten by Git Bash on Windows.

### Take a backup
```bash
docker compose exec -T postgres sh -c "pg_dump -U dumbbill -d dumbbill --format=custom --file=/tmp/backup.dump"
docker compose cp postgres:/tmp/backup.dump ./backup-$(date +%F).dump      # Git Bash: prefix with MSYS_NO_PATHCONV=1
docker compose exec -T postgres sh -c "rm /tmp/backup.dump"
```
Keep the `.dump` file outside the repository (it contains data). `*.dump` must never be committed.

### Check a backup by restoring it into a scratch database
```bash
docker compose cp ./backup-2026-10-18.dump postgres:/tmp/backup.dump      # Git Bash: MSYS_NO_PATHCONV=1
docker compose exec -T postgres psql -U dumbbill -d postgres -c "CREATE DATABASE restore_check"
docker compose exec -T postgres sh -c "pg_restore -U dumbbill -d restore_check --no-owner --exit-on-error /tmp/backup.dump"
# compare, for example the number of tables and rows in an important table, with the live database
docker compose exec -T postgres psql -U dumbbill -d restore_check -tAc "select count(*) from information_schema.tables where table_schema='public'"
docker compose exec -T postgres psql -U dumbbill -d postgres -c "DROP DATABASE restore_check"
docker compose exec -T postgres sh -c "rm /tmp/backup.dump"
```
Verified on 18 Oct 2026: the dump restored with exit code 0 and the same table count as the live database.

### Replace your dev database with a backup
Only on your own machine, and only if you are sure. Restore into a scratch database as above, then either point `DATABASE_URL` and `APP_DATABASE_URL` at it, or (the simplest) run `pnpm db:reset` yourself in a terminal and re-seed. After a restore into a different database, run `pnpm db:roles` so the `dumbbill_app` role has its grants (see `database-and-seeding.md`).

### Uploaded files
Files live on the server disk (`STORAGE_LOCAL_DIR`, see `file-storage.md`). A database backup does **not** include them. Back up that folder at the same time, and restore both together, or invoices will point at missing files.

## B. Production (fill in when hosting is chosen)

| Item | Decision / value |
|---|---|
| Where backups are stored | TO FILL (provider backups plus a copy in a second region/account) |
| How often (full / point-in-time log shipping) | TO FILL (needed to meet RPO ≤ 5 min) |
| How long they are kept | TO FILL (point-in-time window 14–35 days; yearly copies per retention policy) |
| Who may restore, and how access is granted | TO FILL |
| Restore steps (point-in-time recovery to a NEW database, verify, then switch the app) | TO FILL |
| Uploaded-files backup | TO FILL (same schedule, same retention) |
| Last successful restore drill (date, who, time taken) | none yet |

### Steps to write once hosting exists
1. Declare an incident if customer data is affected (`incident.md`).
2. Choose the recovery point (time just before the damage).
3. Restore to a **new** database instance; do not touch the live one.
4. Check: table counts, newest invoice number per branch, `pnpm db:status`, the stock invariant check (sum of ledger equals stock levels).
5. Switch the application to the restored database (change the connection settings, restart).
6. Confirm the app role is not a superuser and RLS still applies (the RLS coverage test must pass against this database).
7. Record what was lost between the recovery point and the incident, and tell affected businesses.

### Quarterly drill (checklist)
- [ ] Pick a recent backup and restore it to a scratch instance.
- [ ] Run the RLS coverage test and the stock invariant check against it.
- [ ] Time it. Write the time and any surprise at the bottom of this file.
- [ ] Delete the scratch instance and its data.

## Drill log
| Date | Who | Source backup | Time to restore | Result / notes |
|---|---|---|---|---|
| 18 Oct 2026 | AI (local dev check) | live dev database | under 1 minute | OK, dev only; not a production drill |
