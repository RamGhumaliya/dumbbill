# Security & Compliance

Target: OWASP ASVS L2, OWASP API Top 10 2023, India DPDP Act 2023, PCI scope avoided (no card data touches our servers; Razorpay hosted checkout).

## 1. Threat model (STRIDE highlights)
| Threat | Example | Control |
|---|---|---|
| Tenant crossing (IDOR/BOLA) | Change `invoiceId` in URL | RLS + tenant-scoped repos + 404 on miss + automated route enumeration test |
| Privilege escalation | Cashier calls admin API | Server-side `PermissionsGuard` on every route (deny-by-default), tests per route/role |
| Cost/profit leak | Product payload includes `unitCost` | Separate DTO types per audience + response contract test + log-scan for fields |
| Discount fraud | Tamper totals in client | Server recomputation, limits, approval tokens bound to cart hash, anomaly report |
| Session theft | XSS steals token | Access token in memory, refresh httpOnly cookie, strict CSP, Trusted Types, no `dangerouslySetInnerHTML` |
| Credential stuffing | Customer email+password | Argon2id, breached-password check (HIBP k-anon), rate limit + progressive delay, optional email-OTP step-up on new device, generic error messages |
| Replay / double submit | Retry checkout | Idempotency keys + unique constraint |
| Webhook forgery | Fake Razorpay event | HMAC signature verify, event-id dedupe, allow-list IPs optional |
| Supply chain | Malicious npm/pub package | Lockfiles, `pnpm audit`, Dependabot/Renovate, provenance, no postinstall scripts by default, SBOM |
| Insider (support/impersonation) | Super admin browsing data | Reason + time-boxed + audited + tenant-visible |
| Data loss | Bad migration / ransomware | PITR, cross-region snapshot copies, restore drills quarterly |
| DoS | Bot floods search | WAF rate rules, per-tenant quotas, request size limits, pagination caps |

## 2. Authentication & sessions
> **Status (18 Oct 2026): implemented in P1-1 for staff accounts**, with the details, decisions and known limits in `docs/adr/006-auth-and-sessions.md` section 6 and the app guide `docs/api/auth-flow.md`. Customer accounts (separate pool) and Super Admin mandatory two-step come later. Passkeys are not built.

- Passwords: Argon2id (m=64MB,t=3,p=1 tuned), min length 10, max 128, no composition rules, breached check. Pepper in Secrets Manager.
- Email verification mandatory; staff accounts invited by owner (no open staff signup).
- Access JWT 15 min (EdDSA/RS256, `kid` rotation), refresh 30 days sliding with rotation + family revocation on reuse.
- Device/session list with revoke; "log out everywhere" on password change.
- Optional TOTP MFA for Owner/Admin/Super Admin (mandatory for Super Admin). Passkeys later.
- Cashier fast-switch: PIN (6 digits, hashed, rate-limited, device-bound) for approvals and shift change — never replaces primary login.
- Customer and staff identity pools separate (`aud` claims, separate tables, separate guards).

## 3. Authorization
> **Status (19 Oct 2026): implemented in P1-2.** Permission catalogue in `permissions.matrix.ts`, `@Permission` + deny-by-default global guard, editable role templates, per-person extras and removals, branch scope, no-escalation rules, audit of refusals, and the automatic route-by-role matrix test. Reasoning and limits: `docs/adr/009-roles-and-permissions.md`. `discount.limit_pct` is not a yes/no permission but a per-role (and per-person) limit in basis points.

- Deny-by-default; every controller declares `@Permission('products.cost.read')`.
- Permission keys (granular): `products.read|write`, `products.cost.read`, `pricing.write`, `purchases.write`, `stock.adjust`, `stock.transfer`, `pos.sell`, `discount.apply`, `discount.limit_pct`, `discount.approve`, `invoice.cancel`, `invoice.refund`, `reports.sales`, `reports.profit`, `team.manage`, `settings.manage`, `loyalty.manage`, `audit.read`.
- Scope = tenant (RLS) + branch set (service layer). Role presets are editable templates, not hardcoded checks (`if role == 'admin'` is banned).
- Matrix tests generated from a single source (`permissions.matrix.ts`) cover every route × role → expected status.

## 4. Data protection
- TLS 1.2+ (1.3 preferred) everywhere, HSTS preload; RDS/S3/EBS encrypted with KMS CMKs; secrets in AWS Secrets Manager (no secrets in repo/env files in git); least-privilege IAM per task role.
- PII field encryption for phone/email at application layer (envelope encryption) if required by threat review; blind index for lookup.
- Backups: automated + PITR 14–35 days, cross-region copy, restore tested quarterly, RPO ≤ 5 min.
- Logs never contain passwords, tokens, full phone numbers, card data, cost data (redaction list in Pino config + CI grep).
- Data retention: invoices 8 years (statutory), audit 8 years, customer PII deletable on request except where law requires retention (anonymise instead).

## 5. Application security controls
- Input validation: zod/class-validator at every boundary; reject unknown fields; max sizes.
- Output: JSON only, correct content-types, `X-Content-Type-Options: nosniff`.
- SQL: parameterised only; no string-built SQL; raw SQL reviewed.
- CSRF: SameSite=Strict + double-submit token for cookie-authenticated endpoints.
- CORS: explicit allow-list; no wildcard with credentials.
- Headers: CSP (nonce-based), `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy (USB/Serial only on /pos).
- Uploads (server disk): extension allow-list, magic-byte content check, size cap, random file names, per-tenant folders, key validation against path traversal, atomic writes, files served only through authenticated routes (never a public static folder). AV scan and image re-encoding are added with the upload route in P1-4. Moving to S3 later: private bucket + signed URLs.
- SSRF: no user-supplied URL fetching; allow-list for outbound.
- Rate limiting + bot protection (WAF managed rules, Turnstile/hCaptcha on signup/login after anomalies).
- Mobile: certificate pinning optional, jailbreak/root signal (warn), secure storage (Keychain/Keystore), screenshot-block on sensitive screens, no secrets in app, obfuscation on release.

## 6. Audit & accountability
> **Status:** the append-only `audit_log` table and writer exist (P1-1; UPDATE and DELETE are refused for the app role and, by trigger, for everyone). **The hash chain and the periodic anchor are not built yet** (planned for P1-6 hardening, they need a design for concurrent writes).

`audit_log` append-only (DB trigger blocks UPDATE/DELETE; role has INSERT only). Events: auth (login/fail/reset), permission changes, price changes, stock adjustments/transfers, discounts above X%, approvals, cancel/refund, exports, impersonation, plan changes. Hash-chain (each row stores hash of previous) for tamper evidence; periodic anchor to S3 Object Lock.

## 7. Privacy (DPDP)
Consent records (purpose, timestamp, version) per customer per shop; granular marketing consent default OFF; data principal rights (access/export/correct/delete) via in-app flow and admin tooling; data processor agreement with each tenant (tenant = fiduciary for their customers, we = processor); breach response plan (72-hour notification workflow); data minimisation (no unnecessary fields); India region hosting; privacy policy & terms pages.

## 8. SDLC security
Threat modelling per epic • PR template with security checklist • SAST (CodeQL/Semgrep) • dependency + container scan (Trivy) • secret scanning (gitleaks, push protection) • IaC scan (tfsec/Checkov) • DAST (ZAP) against a local dev instance • pen-test before launch (external) • bug-bounty/security.txt after • quarterly access reviews.

## 9. Incident response
Severity levels SEV1–4, on-call rotation, runbooks (`/docs/runbooks`), status page, post-mortems blameless within 5 days, customer comms template.
