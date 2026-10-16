# Phase 4 – Apps & Launch (Weeks 10–14)

## P4-1 Mobile integration layer  (mobile-dev)
```
Foundation exists from P0-6. Build the retrofit API interfaces against the backend Swagger for auth, customer, owner, loyalty and reports; auth refresh flow; error mapping; drift cache for history. Releases are manual: no store pipeline work.
```

## P4-2 Customer app  (mobile-dev + ui-designer, R3)
```
Stories: US-APP-01. Register/login/verify/reset, join by QR scan/code/link, multi-shop wallet with separate balances, rotating membership QR (60 s token, brightness boost), offers feed, points history, purchase history/invoice view, consent settings, delete account. Empty states illustrated (custom), motion per design-guide §5, offline cache of history.
```

## P4-3 Owner app  (mobile-dev)
```
Stories: US-APP-02. Biometric unlock, today dashboard, branch comparison, alerts, approvals (push → approve/reject with reason), stock alerts, sales trend. FCM push with topic/segment per tenant & role. Respect permissions: margin card absent without reports.profit.
```

## P4-4 Subscriptions & plan limits  (backend-dev, R2)
```
Stories: US-SUB-01, US-SUB-02. Plans table (Starter/Growth/Pro, 14-day trial, data-driven limits), Razorpay Subscriptions (create, mandate/UPI AutoPay, trial), webhook endpoint with HMAC verification + event-id dedupe + replay protection, state machine trial→active→past_due→grace→suspended→cancelled, dunning emails, plan-limit guards (branches/users), downgrade checks, GST invoices for our own subscription fees, billing portal UI.
```

## P4-5 Super Admin portal  (backend-dev + frontend-dev, R2)
```
Stories: US-SA-01. Retailer list/search, lifecycle (approve, suspend, reactivate), usage metrics, plan overrides, dunning list, impersonation (reason required, 30-min expiry, audit entry, banner shown to the tenant), platform reporting. Mandatory TOTP for super admins, IP allow-list option.
```

## P4-6 Launch hardening  (qa-engineer, security-auditor, architect)
```
Full regression + load test at 2× expected, external pen-test remediation, DR drill (only once deployment is decided) (restore to point in time), chaos checks (kill DB failover, Redis flush), mobile store compliance guidance for the owner's manual release (privacy labels, data-safety form), SES production access with DKIM/SPF/DMARC, status page, runbooks complete, CA sign-off on invoice & GST report, pilot UAT sign-off. Produce docs/06-tracking/launch-readiness.md with go/no-go table.
```
