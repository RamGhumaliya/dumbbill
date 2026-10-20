# Database, Migrations and Seed Data

## Concepts in plain words

- **Schema** (`prisma/schema.prisma`): the single file describing every table.
- **Migration** (`prisma/migrations/*`): a saved, ordered step that changes the database (create a table, add a column). Migrations are committed to git so everyone, and later the live server, gets the exact same structure.
- **Seed**: starter data loaded into the database after the tables exist.

## Database users (roles) and tenant protection

The database has two users on purpose:

| User                      | Setting            | Used for                      | Power                                                                                                                               |
| ------------------------- | ------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Owner (`dumbbill` in dev) | `DATABASE_URL`     | migrations, seeds, role setup | creates and changes tables                                                                                                          |
| App (`dumbbill_app`)      | `APP_DATABASE_URL` | the running API               | reads and writes rows only. Cannot change structure, cannot read Prisma's migration table, and **cannot bypass row-level security** |

Row-level security (RLS) is a PostgreSQL feature that hides rows from queries unless they belong to the business the request is for. It means that even a coding mistake cannot show one shop another shop's data. How it works, in one paragraph: every request runs inside a transaction that starts by telling PostgreSQL the business id (`app.tenant_id`); each tenant table has a policy saying "only rows whose `tenant_id` equals that id". If no id was set, no rows are visible. Code uses `TenantTx` to do this automatically. Full explanation: `docs/adr/002-prisma-rls.md`.

`pnpm db:roles` creates or refreshes the app user (safe to repeat). `pnpm db:migrate` and `pnpm db:deploy` run it first, so you normally never call it yourself.

In development the owner is a database superuser, which ignores RLS. That is why the API and all security tests connect as the app role.

### Adding a table that holds business data

1. In `schema.prisma` add `tenantId String @map("tenant_id") @db.Uuid`, an index that starts with `tenant_id`, and `@default(uuid(7))` on the id.
2. `pnpm db:migrate --name add_<thing>`.
3. Open the new `migration.sql` and add at the bottom:
   ```sql
   SELECT enable_tenant_rls('<table>');
   SELECT app_grant_defaults();
   ```
4. `pnpm test:sec`. If you forgot a step, the test fails and names the table and the missing piece.

A table that is shared by everyone (like `plans`) is the exception: it must be added to `GLOBAL_TABLES` in `test/support/rls-audit.ts` on purpose.

## Everyday commands

| Command           | When to use it                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate` | After editing `schema.prisma`, or after pulling code that includes new migrations. Creates the migration if you changed the schema, and applies it |
| `pnpm db:status`  | See which migrations are applied                                                                                                                   |
| `pnpm db:deploy`  | On a server: apply migrations that already exist, never create new ones                                                                            |
| `pnpm db:studio`  | Open a web page to browse and edit rows                                                                                                            |
| `pnpm db:reset`   | Start over: **deletes all data**, re-applies migrations, re-seeds. Local only                                                                      |

### Changing the schema

1. Edit `prisma/schema.prisma`.
2. Run `pnpm db:migrate`, give the migration a short name when asked (for example `add_branches`).
3. Commit the new folder in `prisma/migrations/` together with the schema change.
4. Never edit a migration after it has been committed. Make a new one instead.

Naming rules (see the top of `schema.prisma`): money is whole **paise** in `BigInt` columns, ids are UUIDs, database names are `snake_case` through `@@map` and `@map`.

## Seed data

Two groups, run from the same command line:

| Group       | Contents                                                                       | Allowed where                                                   |
| ----------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `reference` | Plans (Starter, Growth, Pro), 38 GST state codes, 5 starter product categories | Everywhere, including production                                |
| `demo`      | Fake shops, products and sales for demos and development                       | Local database only. Added from Phase 1 once those tables exist |

```bash
pnpm db:seed                         # reference data
pnpm db:seed:demo                    # reference + demo (local only)
pnpm db:seed:list                    # show seeders
pnpm db:seed:shops                   # 3 demo businesses with 200 products each (local only, see below)
pnpm db:seed -- --only plans         # run just one seeder
```

### Safe to repeat

Every seeder uses "update or insert", so running the seed twice gives the same result as running it once. Run it freely after pulling changes. Output shows `created` and `updated` counts; the second run shows `created 0`.

### Safety rules

- Demo data is **refused** when `NODE_ENV=production` or when the database is not on this machine. The check happens before anything is written.
- `pnpm db:reset` first runs `scripts/assert-not-production.mjs`, which stops it on production or on any non-local database.
- Seeders never delete or overwrite data created by real users. For example, re-seeding plans does not re-activate a plan that an admin deactivated.

### Demo businesses (`pnpm db:seed:shops`)

Loads three made-up businesses so every screen has believable data: **Iron Temple Nutrition** (Pune), **FitFuel Supplements** (Bengaluru) and **Muscle Mart Delhi**, each with two branches, an owner, an admin and a cashier, **200 products** (whey, creatine, pre-workout, BCAA, mass gainers, vitamins, accessories, apparel; GST 18% and 5%), four suppliers, and a **year of monthly purchase bills per branch** (so stock, the stock ledger, weighted average cost and the audit log are filled). The newest bill of each first branch holds three short-dated batches (near-expiry alerts) and every seventh product has a low-stock level.

- Sign in with `owner@`, `admin@` or `cashier@` plus `irontemple.demo.test`, `fitfuel.demo.test` or `musclemart.demo.test`, and the password `Dumbbill-demo-2026`. These addresses are on the reserved `.test` domain: no mail can ever reach them.
- It first runs `prisma/seed/demo-guard.ts`, which **refuses** when `NODE_ENV=production` or the database is not on this machine. Run `pnpm db:seed` (reference data) first.
- It calls the real services (products, suppliers, purchases...) instead of writing rows, so demo data obeys every rule the product enforces. That is also why it is built with `nest build` and run from `dist/demo/main.js` (the services need decorator metadata, which `tsx` does not produce).
- Safe to repeat: a business whose owner already exists is skipped. To start over use `pnpm db:reset`.
- Takes about 40 seconds. A year of **sales** is not loaded yet: invoices arrive with the till in Phase 2, and the seed will grow them then.
- The data lives in `src/demo/demo-catalogue.ts` and `src/demo/demo-shops.ts` (made-up values; HSN and GST rates still need the CA's confirmation). `test/unit/demo-data.spec.ts` checks that the demo data passes the product's own rules.

### Changing seed data

| To change...                             | Edit                                     | Then                                                                                                 |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Plan limits or prices                    | `prisma/seed/data/plans.ts`              | `pnpm db:seed`. Prices are in **paise** (Rs 999 = `99900n`). They are `null` until the owner decides |
| Starter categories, HSN codes, GST rates | `prisma/seed/data/category-templates.ts` | `pnpm db:seed`                                                                                       |
| GST state list                           | `prisma/seed/data/gst-states.ts`         | `pnpm db:seed`                                                                                       |

The HSN codes and GST rates in the category templates are **suggested defaults only**. They must be confirmed by your CA before launch.

### Adding a new seeder

1. Put the raw data in `prisma/seed/data/<thing>.ts`, with comments saying where it came from.
2. Write a `Seeder` in `prisma/seed/seeders/` (the rules are in `prisma/seed/types.ts`: repeatable, only touch your own data, no random values).
3. Add it to the list in `prisma/seed/registry.ts`, choosing `reference` or `demo` and a unique `order`.
4. Add checks to `test/unit/seed.spec.ts` for the data.

## Reset and "start fresh"

```bash
pnpm db:reset            # wipes the local database, migrates, seeds
```

If you are using an AI assistant: Prisma deliberately blocks AI tools from running `migrate reset` without explicit consent. Run `pnpm db:reset` yourself in the terminal.

## Backups (when you deploy)

Back up the PostgreSQL database **and** the uploads folder together, since invoices and images are in the folder and everything else is in the database. See `file-storage.md`.
