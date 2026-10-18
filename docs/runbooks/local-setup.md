# Local Setup (Windows, macOS, Linux)

How to get the backend running on your machine from nothing. About 15 minutes the first time.

## 1. Install the tools

| Tool | Version | Check with | Get it |
|---|---|---|---|
| Node.js | 22 or newer | `node -v` | https://nodejs.org (LTS) |
| pnpm | 10 | `pnpm -v` | `npm install -g pnpm` |
| Git | any recent | `git --version` | https://git-scm.com |
| Docker Desktop | any recent | `docker -v` | https://www.docker.com/products/docker-desktop |

Start **Docker Desktop** and wait until it says it is running. Nothing database-related works without it.

## 2. Get the code and install packages

```bash
cd dumbbill-backend
pnpm install
```

`pnpm install` also generates the Prisma database client. If pnpm prints "Ignored build scripts", run `pnpm approve-builds` and allow `@prisma/client`, `@prisma/engines` and `prisma`.

## 3. Create your settings file

```bash
cp .env.example .env          # Git Bash / macOS / Linux
copy .env.example .env        # Windows PowerShell or cmd
```

The defaults already match the Docker services, so you do not need to edit anything. Note the two database addresses: `DATABASE_URL` (the powerful owner, for migrations and seeds) and `APP_DATABASE_URL` (the restricted role the API runs as). See `database-and-seeding.md`. `.env` is private to your machine and is never committed.

## 4. Start the supporting services

```bash
docker compose up -d
docker compose ps
```

You should see three services: `postgres` (healthy), `redis`, `mailpit` (healthy).

| Service | Address | Used for |
|---|---|---|
| PostgreSQL | localhost:5432 (user, password and database are all `dumbbill`) | The database |
| Redis | localhost:6379 | Queues, caching, rate limits (used from later phases) |
| Mailpit | http://localhost:8025 (SMTP on 1025) | Shows emails the app "sends" |

## 5. Create the tables and load starter data

```bash
pnpm db:migrate     # creates the restricted database role, then the tables
pnpm db:seed        # loads plans, GST states and starter categories
```

Details and what each command does: `database-and-seeding.md`.

## 6. Run the API

```bash
pnpm dev
```

Check it works:

```bash
curl http://localhost:3000/healthz     # {"status":"ok"}
curl http://localhost:3000/readyz      # {"status":"ok","checks":{"database":"up"}}
```

Open http://localhost:3000/docs to see the API manual.

## 7. Check your setup is healthy

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int
```

All four should finish with no errors.

## 8. Run the web app (optional, in a second terminal)

```bash
cd dumbbill-web
pnpm install
cp .env.development.example .env.development      # PowerShell: copy .env.development.example .env.development
pnpm dev                                          # http://localhost:3001
```

It works without the API running; the owner dashboard then shows "Cannot reach the server" with a reference. Start the API (steps 4 to 6) and reload to see "Server is ready". Port 3001 is used because the API owns 3000. Details, commands and a code map: `dumbbill-web/README.md`.

For the browser tests: `pnpm exec playwright install chromium` once, then `pnpm test:e2e`. For a local production build (`pnpm build`) create `.env.production` from `.env.production.example` and set the API address to `http://localhost:3000`.

## 8b. Run the mobile apps (optional)

You need Flutter with the Android SDK and an Android emulator (create one in Android Studio's Device Manager; a phone image such as Pixel 9 works). Start the API first (steps 4 to 6).

```bash
cd dumbbill-mobile
flutter pub get
dart run build_runner build
flutter run --flavor ownerDev -t lib/main_owner.dart --dart-define-from-file=config/dev.json
```

Use `--flavor customerDev -t lib/main_customer.dart` for the customer app. The emulator reaches your API at `10.0.2.2:3000`. The first Android build is slow (several minutes). Full details: `dumbbill-mobile/README.md`.

## Daily routine

```bash
docker compose up -d     # if Docker was restarted
pnpm dev                 # work
docker compose stop      # at the end of the day (keeps your data)
```

`docker compose down` removes the containers but keeps data. `docker compose down -v` also **deletes the database data**.

## Where things are stored on your machine

| Data | Location |
|---|---|
| Database | Docker volume `pgdata` |
| Uploaded files | `dumbbill-backend/storage/` (ignored by git) |
| Settings | `dumbbill-backend/.env` (ignored by git) |

## Stop everything

```bash
# Stop the API: Ctrl+C in the terminal running pnpm dev
docker compose stop
```

## Environments: only two

| Environment | Where | Settings |
|---|---|---|
| `dev` | Your machine | `dumbbill-backend/.env` (copied from `.env.example`). Web: `.env.development`. Mobile: flavor `dev` |
| `prod` | The live server (later) | Real environment variables on the server, using `.env.production.example` as the checklist. Web: `.env.production`. Mobile: flavor `prod` |

There is no staging. Because live has no rehearsal copy, try changes locally with seed data first, keep database migrations backward compatible, and never copy real customer data to a laptop. Automated tests set `NODE_ENV=test` by themselves; you never do that by hand.

Never commit real `.env` files. Only the `.example` templates are committed.
