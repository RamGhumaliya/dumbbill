# dumbbill-web – Rules

Next.js App Router (TypeScript strict) · Tailwind + Radix/React-Aria · TanStack Query + Table · Zustand (POS cart) · react-hook-form + zod · next-intl · Playwright.
Read `../CLAUDE.md`, `../docs/02-design/design-guide.md`, `../docs/03-engineering/standards.md`.

## Structure

`src/app/(owner)` · `src/app/(pos)` · `src/app/(admin)` (super admin) · `src/components/ui` (our design system built on Radix) · `src/features/<feature>` · `src/lib/api` (typed API layer written against the backend Swagger) · `src/styles/tokens` (generated from tokens JSON) · `messages/en.json`.

## Environments

Only `dev` and `prod`: `.env.development` and `.env.production` (templates committed as `.example` files, real values never).

## Design system rules (P0-5)

- Build screens ONLY from `src/components/ui` (import from `@/components/ui`). Need something new? Add it there, show it in `src/components/design/gallery.tsx`, test it in `tests/e2e/design-system.spec.ts`. Never style one-off lookalikes inside a screen.
- **No raw colours or pixel sizes in code or hand-written CSS** (`#fff`, `w-[13px]`, `12px`). Use token classes (`bg-surface`, `text-muted`, `border-line`, `rounded-card`, `text-small`, `min-h-(--size-control-md)`). The lint rule and `tests/unit/design-rules.spec.ts` fail otherwise.
- Colours, type, radius and motion come from `../docs/02-design/tokens/tokens.json`. Edit it, run `pnpm tokens`, never edit the generated files (`src/styles/tokens.css`, `src/styles/tailwind-theme.css`, `src/lib/design/token-names.ts`). Every colour pair must pass WCAG contrast in BOTH themes.
- Money is always `<MoneyText paise={...} />` (never format by hand). Icons come from `@/components/ui/icons`. Show money with Indian grouping.
- Every interactive component: Radix primitive where one exists, all states (hover, focus, disabled, loading, invalid, empty, error), keyboard operable, both themes. Meaning is never carried by colour alone.
- Review each new screen with the checklist in `../docs/runbooks/design-system.md` (squint, swap, real data, anti-AI-look).

## Rules

- API layer: one typed function per endpoint, zod-validate responses at the boundary, central error handling for problem+json (show `requestId` to user on errors). Tokens in memory; refresh via httpOnly cookie.
- Styling only through tokens (dark = Iron Ledger, light = Quiet Ledger, switch via `data-theme`). No raw hex/px; no default component-library look.
- POS: keyboard-first, scanner (HID wedge) input handling, offline queue in IndexedDB (encrypted), service worker, server totals are truth; print via browser CSS 58/80 mm and WebUSB/WebSerial ESC/POS.
- Authoritative money math is on the server. Local pricing preview exists only for offline and must pass the shared golden fixtures.
- All states: loading, empty, error, offline, permission-denied. a11y: axe in Playwright. Honour reduced motion and performance budgets in `standards.md`.

## Comments (mandatory)

Follow the "Comments" section of `../CLAUDE.md`: file purpose, a doc comment on every exported symbol, and the _why_ behind business rules, security choices and non-obvious code, in plain English.
