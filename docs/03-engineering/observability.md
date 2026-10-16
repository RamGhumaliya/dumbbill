# Logging, Error Tracking & Observability

## 1. Principles
- Every request is traceable end-to-end by `requestId` (also returned to the user in error toasts: "Ref: 8f3a…").
- Logs are structured JSON, safe by default, and queryable by tenant/branch/user.
- Alerts are actionable and tied to SLOs; no alert without a runbook.

## 2. Logging (Pino)
Fields on every line: `ts, level, service, env, version, requestId, traceId, spanId, tenantId, branchId, userId(hash), route, method, status, durationMs, msg`.
- Levels: `fatal` (process dying) · `error` (unexpected, pages someone if rate high) · `warn` (handled anomaly e.g. rejected discount) · `info` (business events: invoice.created) · `debug` (off in prod, dynamic toggle per tenant for 30 min).
- **Redaction**: `req.headers.authorization, cookie, *.password, *.token, *.pin, *.otp, *.unitCost, *.wac, *.costAtSale, *.profit, phone→last4, email→masked`. CI test fails if a log fixture contains forbidden keys.
- Log business events (not just errors): `invoice.created`, `discount.rejected`, `approval.granted`, `stock.adjusted`, `sync.conflict`, `login.failed` (with reason code).
- Retention: CloudWatch 30 days hot, S3 archive 1 year (security/audit logs 8 years).
- Sampling: `info` for health checks dropped; high-volume `debug` sampled.

## 3. Error tracking (Sentry)
- Projects: `api`, `web`, `mobile-owner`, `mobile-customer`, `worker`. Releases + source maps/dSYM/mapping files uploaded in CI; `environment` tagged.
- Scrub PII (`beforeSend`), tag `tenantId`, `role`, `plan` (no emails), attach `requestId`.
- Frontend: global error boundary with friendly UI + "Copy error reference"; unhandled rejection capture; session replay **off by default** on POS (privacy), masked if enabled elsewhere.
- Flutter: `FlutterError.onError`, `PlatformDispatcher.onError`, Sentry navigation observer, ANR/native crash capture.
- Triage: auto-assign by module (CODEOWNERS), SLA: SEV1 15 min, SEV2 4 h.
- Release health: block rollout if crash-free < 99.5% (staged rollout on Play/TestFlight).

## 4. Metrics & traces (OpenTelemetry → CloudWatch / X-Ray; Grafana optional)
- RED per route (rate, errors, duration), DB query time, pool saturation, queue depth/age, Redis latency.
- Business metrics: invoices/min per tenant, checkout success rate, discount-rejection rate, offline-sync backlog, webhook failures, report query time.
- Tracing: auto-instrument HTTP, pg, redis, BullMQ; custom spans around checkout stages (pricing, stock lock, tax, persist).
- Frontend: Web Vitals (LCP, INP, CLS) reported via `web-vitals` → OTel; POS custom timings (scan→cart paint, pay→print).

## 5. SLOs & alerts
| SLO | Target | Alert |
|---|---|---|
| API availability | 99.9% / 30 d | Burn-rate (2% in 1 h, 5% in 6 h) |
| Checkout success | 99.95% | < 99.5% over 10 min → page |
| Checkout p95 | < 500 ms | > 800 ms for 10 min → warn |
| Sync backlog age | < 5 min | > 15 min → warn |
| Webhook processing | 100% within 5 min | DLQ > 0 → page |
| DB | CPU < 70%, connections < 80%, replica lag < 5 s | threshold alerts |
| Security | spikes in 401/403, login failures per IP/tenant, RLS violation errors | page security on-call |
Plus: uptime checks (Route 53/BetterStack) for web, API `/healthz` (liveness) and `/readyz` (db, redis), synthetic POS checkout probe every 5 min against a dedicated test tenant in prod.

## 6. Dashboards
1. Service health (RED) 2. Business pulse (bills/min, GMV) 3. Tenant drill-down 4. DB & queues 5. Security 6. Mobile release health.

## 7. Audit vs logs
Logs are operational and expire; **audit_log is business/legal evidence** stored in Postgres, append-only. Do not use one for the other.

## 8. Support tooling
Support can search by `requestId` or invoice number → sees trace, logs, Sentry link, audit trail (read-only, PII-masked unless impersonation is approved).
