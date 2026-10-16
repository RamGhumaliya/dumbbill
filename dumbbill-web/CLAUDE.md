# dumbbill-web – Rules

Next.js App Router (TypeScript strict) · Tailwind + Radix/React-Aria · TanStack Query + Table · Zustand (POS cart) · react-hook-form + zod · next-intl · Playwright.
Read `../CLAUDE.md`, `../docs/02-design/design-guide.md`, `../docs/03-engineering/standards.md`.

## Structure

`src/app/(owner)` · `src/app/(pos)` · `src/app/(admin)` (super admin) · `src/components/ui` (our design system built on Radix) · `src/features/<feature>` · `src/lib/api` (typed API layer written against the backend Swagger) · `src/styles/tokens` (generated from tokens JSON) · `messages/en.json`.

## Environments

Only `dev` and `prod`: `.env.development` and `.env.production` (templates committed as `.example` files, real values never).

## Rules

- API layer: one typed function per endpoint, zod-validate responses at the boundary, central error handling for problem+json (show `requestId` to user on errors). Tokens in memory; refresh via httpOnly cookie.
- Styling only through tokens (dark = Iron Ledger, light = Quiet Ledger, switch via `data-theme`). No raw hex/px; no default component-library look.
- POS: keyboard-first, scanner (HID wedge) input handling, offline queue in IndexedDB (encrypted), service worker, server totals are truth; print via browser CSS 58/80 mm and WebUSB/WebSerial ESC/POS.
- Authoritative money math is on the server. Local pricing preview exists only for offline and must pass the shared golden fixtures.
- All states: loading, empty, error, offline, permission-denied. a11y: axe in Playwright. Honour reduced motion and performance budgets in `standards.md`.

## Comments (mandatory)

Follow the "Comments" section of `../CLAUDE.md`: file purpose, a doc comment on every exported symbol, and the _why_ behind business rules, security choices and non-obvious code, in plain English.
