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

## Sign-in rules (P1-1). Guide: `../docs/api/auth-flow.md`

- Screens behind login are wrapped in `AuthGate` (owner, POS, admin layouts). **They fetch data in the browser** with `getBrowserApiClient()`; a Server Component cannot know who is asking because the access token lives only in browser memory. Never put tenant data in a Server Component behind the gate.
- Access token: in memory only (`src/lib/api/auth.ts`). Never `localStorage`, `sessionStorage` or a readable cookie. Refresh token: httpOnly cookie; renewal and sign-out send `X-CSRF-Token` (value of the `dumbbill_csrf` cookie).
- Anything a stranger can reach (sign up, resend, forgot password, login errors) must show the **same words whether or not the account exists**. Never write "email already registered".
- `?next=` is always passed through `safeNextPath` (no open redirects). Notices in the address (`?notice=`) are looked up in a fixed list, never printed.
- After sign-out, wipe everything held for the person: `endSession` clears the query cache and the POS cart. Add any new per-person client state to it.
- Forms: `useApiForm` + a zod schema built from the translator (`buildSchema(t)`), field errors from the server through `form.applyServerErrors` (use `renames` when the API's field name differs). Error wording comes from `describeApiError`, chosen by error CODE.
- Browser tests of gated screens start signed in with `signIn(page, context)` from `tests/e2e/support/mock-api.ts` (a pretend API; it records every call so tests can check headers and bodies).

## Business and branch screens (P1-3). Guide: `../docs/api/business-and-branches.md`

- Screens live in `src/components/business/` and are loaded in the browser (behind `AuthGate`). Show or hide buttons with `useCan('settings.manage')`; it is a convenience only, the API refuses what is not allowed.
- The profile and branch forms share the address, state and GSTIN fields (`place.tsx`). The browser only checks a GSTIN's SHAPE; the check character and state agreement come back from the server as a field error, shown under the box (`form.applyServerErrors`; `CONFLICT` field lists are handled too).
- Files: the API client sends a `FormData` body as multipart (never set its Content-Type by hand) and can read a file answer with `expect: 'blob'`. The logo needs the token, so it is downloaded and shown from memory, not with a plain `<img src>`.
- A new first-steps checklist item comes from the server (`GET /v1/business/onboarding`); add its wording under `Business.onboarding.steps` and its link in `onboarding-checklist.tsx`.

## Catalogue screens (P1-4). Guide: `../docs/api/catalogue.md`

- Screens live in `src/components/products/`. **Cost and margin exist only for people with `products.cost.read`** (`useCan`): the table column, the column picker entry and the form box are absent for everyone else, and the form must not send `purchaseCostPaise` for them. The API returns those fields only to them (they are optional in `schemas/products.ts`).
- **A price is never edited in place.** Table cells only PROPOSE a new price; the Change price dialog asks why and records it. The price form on a new product sets the first price only.
- Money in boxes is rupee text turned into paise with `parseRupeesToPaise` (exact, no floats); show it with `MoneyText`.
- Keyboard: price buttons carry `data-price-cell` for Arrow Up/Down; a button's accessible name must contain its visible text (axe `label-content-name-mismatch`).
- The column choice is remembered in `localStorage` as a per-person convenience only; always wrap in try/catch.

## Purchasing, stock and audit screens (P1-5). Guide: `../docs/api/purchasing-and-stock.md`

- Screens live in `src/components/{purchasing,stock,audit}/`; product choice uses `ProductPicker` (datalist; it resolves a pasted full label back to the product).
- **One Idempotency-Key per form instance** (made when the form opens, resent on retry, renewed only after success). Never build a key per click.
- **Cost columns, value and the average exist only with `products.cost.read`** (`useCan`); tabs and buttons for counts, history and transfers follow `stock.adjust` / `stock.transfer`. The server refuses regardless.
- Purchase entry preview maths is `src/lib/inventory/costing.ts`, which mirrors the server's; the server's answer is the truth. Change both together (shared worked examples in the unit tests).
- Map server errors on `lines[i].field` to row `i`; see `purchase-form.tsx`.

## Rules

- API layer: one typed function per endpoint, zod-validate responses at the boundary, central error handling for problem+json (show `requestId` to user on errors). Tokens in memory; refresh via httpOnly cookie (built in P1-1, see the sign-in rules above).
- Styling only through tokens (dark = Iron Ledger, light = Quiet Ledger, switch via `data-theme`). No raw hex/px; no default component-library look.
- POS: keyboard-first, scanner (HID wedge) input handling, offline queue in IndexedDB (encrypted), service worker, server totals are truth; print via browser CSS 58/80 mm and WebUSB/WebSerial ESC/POS.
- Authoritative money math is on the server. Local pricing preview exists only for offline and must pass the shared golden fixtures.
- All states: loading, empty, error, offline, permission-denied. a11y: axe in Playwright. Honour reduced motion and performance budgets in `standards.md`.

## Comments (mandatory)

Follow the "Comments" section of `../CLAUDE.md`: file purpose, a doc comment on every exported symbol, and the _why_ behind business rules, security choices and non-obvious code, in plain English.
