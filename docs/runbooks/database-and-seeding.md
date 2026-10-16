# Database, Migrations and Seed Data

## Concepts in plain words

- **Schema** (`prisma/schema.prisma`): the single file describing every table.
- **Migration** (`prisma/migrations/*`): a saved, ordered step that changes the database (create a table, add a column). Migrations are committed to git so everyone, and later the live server, gets the exact same structure.
- **Seed**: starter data loaded into the database after the tables exist.

## Everyday commands

| Command | When to use it |
|---|---|
| `pnpm db:migrate` | After editing `schema.prisma`, or after pulling code that includes new migrations. Creates the migration if you changed the schema, and applies it |
| `pnpm db:status` | See which migrations are applied |
| `pnpm db:deploy` | On a server: apply migrations that already exist, never create new ones |
| `pnpm db:studio` | Open a web page to browse and edit rows |
| `pnpm db:reset` | Start over: **deletes all data**, re-applies migrations, re-seeds. Local only |

### Changing the schema

1. Edit `prisma/schema.prisma`.
2. Run `pnpm db:migrate`, give the migration a short name when asked (for example `add_branches`).
3. Commit the new folder in `prisma/migrations/` together with the schema change.
4. Never edit a migration after it has been committed. Make a new one instead.

Naming rules (see the top of `schema.prisma`): money is whole **paise** in `BigInt` columns, ids are UUIDs, database names are `snake_case` through `@@map` and `@map`.

## Seed data

Two groups, run from the same command line:

| Group | Contents | Allowed where |
|---|---|---|
| `reference` | Plans (Starter, Growth, Pro), 38 GST state codes, 5 starter product categories | Everywhere, including production |
| `demo` | Fake shops, products and sales for demos and development | Local database only. Added from Phase 1 once those tables exist |

```bash
pnpm db:seed                         # reference data
pnpm db:seed:demo                    # reference + demo (local only)
pnpm db:seed:list                    # show seeders
pnpm db:seed -- --only plans         # run just one seeder
```

### Safe to repeat

Every seeder uses "update or insert", so running the seed twice gives the same result as running it once. Run it freely after pulling changes. Output shows `created` and `updated` counts; the second run shows `created 0`.

### Safety rules

- Demo data is **refused** when `NODE_ENV=production` or when the database is not on this machine. The check happens before anything is written.
- `pnpm db:reset` first runs `scripts/assert-not-production.mjs`, which stops it on production or on any non-local database.
- Seeders never delete or overwrite data created by real users. For example, re-seeding plans does not re-activate a plan that an admin deactivated.

### Changing seed data

| To change... | Edit | Then |
|---|---|---|
| Plan limits or prices | `prisma/seed/data/plans.ts` | `pnpm db:seed`. Prices are in **paise** (Rs 999 = `99900n`). They are `null` until the owner decides |
| Starter categories, HSN codes, GST rates | `prisma/seed/data/category-templates.ts` | `pnpm db:seed` |
| GST state list | `prisma/seed/data/gst-states.ts` | `pnpm db:seed` |

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
