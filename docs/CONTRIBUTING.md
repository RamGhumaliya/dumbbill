# Contributing

Applies to everyone and to the AI assistant. The hard rules are in `CLAUDE.md` (workspace root) and each app folder's own `CLAUDE.md`.

## Workflow

1. Pick a step from `docs/06-tracking/progress-tracker.md` and its prompt in `docs/05-ai-kit/prompts/`.
2. Create a branch from `main`: `feat/short-name`, `fix/short-name`, `docs/short-name`.
3. Make small, focused changes. Aim for a pull request under 400 lines.
4. Before pushing, run in the app folder you changed. Backend: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm test:sec`. Web: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.
5. Open a pull request. Describe what changed and why, and link the story IDs (for example `US-POS-02`).
6. Get a review (the `reviewer` agent, plus `security-auditor` for login, permissions, tenancy, money or file changes).
7. Squash-merge. Tick the tracker.

## Commit messages (enforced by a hook)

`type: short description in present tense`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.
Examples: `feat: add branch list endpoint`, `fix: round discount on bill level`.

## Code standards in short

- TypeScript strict, no `any`, no `console` (use the logger).
- Money is always whole **paise** (integers). Never floats.
- Every API route: declared permission, request validation, full Swagger docs with success **and** error responses (`docs/03-engineering/api-docs-standard.md`).
- Cashier-facing responses must never include cost or profit fields.
- Every new tenant table gets `tenant_id` and a row-level-security policy.
- **Comments are mandatory**: a purpose comment per file, a doc comment on every exported class/function/type, and the *why* behind business rules and non-obvious code, in plain English. Review blocks code without them.
- No dead code, no unexplained TODOs, no secrets in code.
- Tests ship with the change, including the failure cases.

## Database changes

Edit `prisma/schema.prisma`, run `pnpm db:migrate`, commit the migration folder with the code. Never edit an old migration. A new table that holds business data also needs `SELECT enable_tenant_rls('<table>'); SELECT app_grant_defaults();` at the bottom of its migration (checklist in the runbook); `pnpm test:sec` fails if you forget. See `docs/runbooks/database-and-seeding.md`.

## Definition of done

Code, tests, Swagger docs, permission matrix updated, audit events where needed, logging without private data, lint and typecheck green, reviewed, tracker updated.
