# Prompt Library – how to use

Run prompts **in order**, one per Claude Code session (or `/clear` between them). Each prompt is self-contained, references docs instead of repeating them, and ends with verification steps. After each prompt: run the Review prompt (R1) and the Security prompt (R2) where marked, then tick the tracker.

## Prompt anatomy (use this template for any new prompt)
```
ROLE:     which agent (architect / backend-dev / frontend-dev / mobile-dev / ui-designer / qa-engineer)
CONTEXT:  docs to read first (paths), stories (IDs)
TASK:     one deliverable, specific
CONSTRAINTS: hard rules from CLAUDE.md that matter here + anything unusual
OUTPUT:   files to create/change, tests required
VERIFY:   commands to run, behaviours to demonstrate
STOP IF:  ambiguity -> ask, record in docs/07-open-questions.md
```

## Reusable review prompts
**R1 – Review:** "Use the `reviewer` agent on the current uncommitted changes against stories <IDs>. Return blocking issues first. Then fix every blocking issue and re-run lint/typecheck/tests."

**R2 – Security:** "Use the `security-auditor` agent on the current changes. For each finding provide a failing test, then fix it. Confirm the IDOR sweep, RBAC matrix and cashier-leak tests are still green."

**R3 – Design polish:** "Use the `ui-designer` agent to critique <screen> against the Anti-AI-look rulebook and Squint+Swap test. List specific changes (tokens, spacing, copy, hierarchy). Apply them with `frontend-dev` and screenshot at 360/768/1440 px in light and dark."

**R4 – Regression:** "Run the full CI locally. Summarise failures grouped by root cause. Fix root causes, not symptoms."

## Index
| File | Phase |
|---|---|
| `phase-0-setup.md` | P0 Setup, ADRs, CI, design tokens |
| `phase-1-foundation.md` | P1 Tenancy, auth, RBAC, catalogue, purchases, ledger |
| `phase-2-pos.md` | P2 POS, discounts, GST, invoices, printing, offline |
| `phase-3-reports-loyalty.md` | P3 Reports and loyalty |
| `phase-4-apps-launch.md` | P4 Mobile apps, billing, super admin, launch |
