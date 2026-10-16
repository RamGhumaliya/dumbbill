# dumbbill-web

The web app for Dumbbill: the owner/admin screens, the point of sale (POS) and the super-admin area.
Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · next-intl · TanStack Query · Zustand · react-hook-form + zod · Playwright.

Rules for contributors and the AI assistant: `CLAUDE.md`. Planning docs live in `../docs`.

## Quick start

You need Node 22 and pnpm 10. The API (`../dumbbill-backend`) does not have to be running: the pages show an honest "cannot reach the server" message until it is.

```bash
pnpm install
cp .env.development.example .env.development     # PowerShell: copy .env.development.example .env.development
pnpm dev                                         # http://localhost:3001
```

Pages:

| Address   | What it is                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`       | Owner dashboard (a layout preview with clearly labelled sample figures, and a live server-status check)               |
| `/pos`    | Point of sale: layout skeleton with a working in-memory bill (payment arrives in Phase 2)                             |
| `/admin`  | Super admin placeholder                                                                                               |
| `/design` | The design-system gallery: every component and state, in both themes (development only; "not found" on the live site) |

Port **3001** is used because the API already uses 3000.

## Commands

| Command                             | What it does                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Dev server with hot reload on port 3001                                                                                      |
| `pnpm build` / `pnpm start`         | Production build, then run it on port 3001. The build needs `.env.production` (see below)                                    |
| `pnpm lint`                         | ESLint, including accessibility rules                                                                                        |
| `pnpm typecheck`                    | TypeScript check                                                                                                             |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                     |
| `pnpm test`                         | Unit tests (no browser, about 2 seconds)                                                                                     |
| `pnpm test:e2e`                     | Browser tests in Chromium against the **production build**: both themes, accessibility (axe), security headers, interactions |
| `pnpm test:all`                     | Both                                                                                                                         |

First time for browser tests only: `pnpm exec playwright install chromium`.
`E2E_DEV=1 pnpm test:e2e` uses the faster dev server while you write tests.

## Settings (two environments: dev and prod)

| File               | Used by                     | Committed?                                                                                      |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `.env.development` | `pnpm dev`                  | No (copy from `.env.development.example`)                                                       |
| `.env.production`  | `pnpm build` / `pnpm start` | No (copy from `.env.production.example`; for a local build point it at `http://localhost:3000`) |

| Variable                   | Meaning                                                   |
| -------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Address of the API, for example `http://localhost:3000`   |
| `NEXT_PUBLIC_APP_VERSION`  | Release name written on error reports                     |
| `NEXT_PUBLIC_SENTRY_DSN`   | Sentry project address. Empty switches error tracking off |

Variables starting with `NEXT_PUBLIC_` are built into the browser code and visible to everyone: **never put a secret in one.** A missing or malformed value stops the build or start with a clear message (`src/lib/env-schema.ts`).

## Code map

```
src/
  app/
    layout.tsx              root shell: language, theme, fonts, translations, data provider, skip link
    globals.css             Tailwind wired to the design tokens (default colours/sizes/radii removed on purpose)
    (owner)/                owner/admin screens   (route groups do not appear in the address)
    (pos)/pos/              point of sale
    (admin)/admin/          super admin
    error.tsx, global-error.tsx, not-found.tsx
  proxy.ts                  adds the per-request Content-Security-Policy (nonce) and Permissions-Policy
  instrumentation*.ts       Sentry start-up (server and browser); off without a DSN
  components/
    ui/                     THE DESIGN SYSTEM: Button, Field, Input, Select, Checkbox, DataTable, Dialog, Popover, Toast,
                            Tabs, Badge, Kbd, MoneyText, EmptyState, Skeleton, icons (import from '@/components/ui')
    design/                 the /design gallery
    layout/                 SiteHeader
    theme/                  ThemeToggle (System / Dark / Light)
    providers/              TanStack Query provider
    owner/, pos/            screen-specific components
  lib/
    api/                    typed API layer (client, errors, request ids, endpoints/, schemas/)
    forms/                  react-hook-form + zod helpers, server validation errors -> form fields
    format/money.ts         paise -> "₹1,24,500.00"
    security/csp.ts         builds the Content-Security-Policy
    env.ts, env-schema.ts   validated settings
    theme*.ts               theme cookie helpers
  stores/pos-cart.ts        the bill being built (Zustand, preview only)
  styles/                   tokens.css and tailwind-theme.css (GENERATED from tokens.json), animations.css (hand-written, from motion tokens)
  fonts/                    self-hosted font files (Latin and Latin-extended) and their licences
  lib/cn.ts                 class-name helper that understands our token names
  i18n/                     next-intl setup and typed message keys
messages/en.json            every user-visible text
tests/unit, tests/e2e       Playwright tests
```

## How things work (short version)

- **Themes.** Dark is "Iron Ledger", light is "Quiet Ledger", one shared type system. The choice (System / Dark / Light) is a cookie, so the server renders the right theme on the first paint without a flash. With no choice, the device setting decides.
- **Design tokens only.** Colours, type, shape and motion are defined once in `../docs/02-design/tokens/tokens.json` and generated into CSS by `pnpm tokens` (which refuses a colour pair that is too faint to read). Tailwind's built-in colours, sizes and radii are removed, so you can write `bg-surface`, `text-muted`, `rounded-card`, but not `bg-blue-500` or `w-[13px]`: a lint rule and tests enforce it. How to change things: `../docs/runbooks/design-system.md`.
- **Components.** Screens are built from `src/components/ui`. Every component works in both themes, with the keyboard, in every state, and passes the accessibility scan. See them all at `/design`.
- **Fonts** are self-hosted (no request to Google). Only Inter Tight has the rupee sign, so the numerals and code stacks fall back to it for `₹`.
- **Translations.** No user-visible text inside components; use `useTranslations`/`getTranslations` with keys from `messages/en.json`. Keys are type-checked.
- **API calls.** One function per endpoint in `src/lib/api/endpoints`, named like the operationId in the backend's Swagger (`http://localhost:3000/docs`). Responses are checked with zod. Every failure becomes an `ApiError` carrying a `code` and the `requestId` to show the user. The access token lives in memory only; refresh is a stub until login exists (P1-1).
- **Money** is whole paise everywhere; only `formatPaise` turns it into text. The POS cart shows a **preview**; the server calculates the real bill.
- **Security.** A strict Content-Security-Policy with a fresh nonce per request (scripts without it will not run), no third-party scripts, USB/serial access only on `/pos`, frame embedding forbidden. Because every request needs its own nonce, pages are rendered per request.
- **Errors.** `error.tsx` shows a plain message plus a reference (requestId or Next's digest) and reports to Sentry when it is on.

## Good to know

- Next.js 16 calls the old "middleware" file `proxy`; that is `src/proxy.ts`.
- The browser cannot call the API yet from a different address: CORS is added on the backend with login (P1-1). Until then only server-side calls (like the status check) work.
- Git hooks are installed by the backend project (`husky`) at the repository root. Commits are formatted and linted automatically.
