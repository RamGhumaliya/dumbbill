# Accounts Checklist (for the owner)

**None of these are needed to keep developing locally.** Cloud, domain, payment, email, push and store work is deferred by the owner's decision. This is the list of accounts to create **when you are ready**, in a sensible order, with why, roughly what it costs, and which phase needs it.

How to use it: tick a box when done, and write **where the login lives** (a password manager), never the password itself here. Costs are rough guides to plan with; check current prices before paying.

**Account-safety rules for every account below:**
- Create it with a **business email you control** (not a personal inbox that others use), turn on **two-factor authentication** at once, and save the recovery codes offline.
- Keep one password manager entry per account. Never share logins by chat or email; use each service's "invite a team member" feature.
- Use the **test/sandbox** mode first wherever it exists (Razorpay, store test tracks).

## Order of need

| # | Account | Why Dumbbill needs it | When | Rough cost | Done |
|---|---|---|---|---|---|
| 1 | **GitHub** (already used) | Hosts the code at `RamGhumaliya/dumbbill`; later runs automatic checks | Now | Free | ✅ |
| 2 | **Domain name** (for example from a registrar you trust) | Website, API address (for example `api.<domain>`), email sending, invoice links | Before first customer demo online | ~₹600–1,500 / year | ☐ |
| 3 | **Brand checks** (see open question 1) | Trademark search (India, classes 9 and 42), domain, Play Store / App Store name, social handles, **before** paying for a domain or store accounts | Before step 2 | Search is free; filing costs extra | ☐ |
| 4 | **Sentry** | Error tracking for API, web and the two mobile apps (already wired, off without a DSN) | When there is a deployed build | Free tier first | ☐ |
| 5 | **Razorpay** (start with **test mode**) | Subscription billing for retailers (Starter / Growth / Pro, 14-day trial). Needs a business account with KYC for live mode | Phase 4 (test mode earlier) | Per-transaction fees; no monthly fee for standard plan | ☐ |
| 6 | **Email sending** (Amazon SES or similar) | Verification emails, password resets, receipts, digests. Needs a verified domain, plus SPF / DKIM / DMARC records | Phase 1 for real emails (Mailpit catches them locally) | Very low per email | ☐ |
| 7 | **Firebase (FCM)** | Push notifications for the mobile apps | Phase 3 / 4 | Free | ☐ |
| 8 | **Google Play Console** | Publishing the Android owner and customer apps | When mobile apps are ready to release (manual) | One-time ~US$25 | ☐ |
| 9 | **Apple Developer Program** | Publishing iOS apps. Also needs a **Mac** to build iOS | When iOS is wanted | ~US$99 / year | ☐ |
| 10 | **AWS** (Mumbai region), when hosting is chosen | Servers, database, file storage, backups, firewall. Target about US$150 / month | Deployment (deferred) | ~US$150 / month target | ☐ |
| 11 | **Uptime monitor** (any simple one) | Alerts if the API or website stops answering | With deployment | Free tier first | ☐ |
| 12 | **Chartered accountant** (not an account, a person) | Reviews the GST invoice, bill of supply and report maths **before Phase 2 ends** (open question 4) | Before Phase 2 ends | Professional fee | ☐ |

## Notes per account

### Domain and email (steps 2 and 6)
Buy the domain first, then set up email sending. Mail from a new domain needs three DNS records (SPF, DKIM, DMARC) or it lands in spam. Keep a second, separate address for **receiving** support mail (the support inbox in the plan).

### Razorpay (step 5)
- Build and test everything in **test mode**; no KYC is needed for that.
- Live mode needs the business's legal details and bank account. Start the KYC early because it can take days.
- We never see card details: checkout is Razorpay-hosted (this keeps us out of the strictest payment-card rules).
- Needed secrets: key id, key secret, **webhook secret**. See `docs/runbooks/rotate-secrets.md`.

### Mobile stores (steps 8 and 9)
- Release is **manual** by decision. Each store needs a privacy policy URL and a data-safety form; the customer app handles personal data, so prepare the privacy policy page (see `security.md` §7).
- The Android signing key is unrecoverable if lost. Back it up offline (see `rotate-secrets.md`).
- iOS needs a Mac for builds and the `dev` / `prod` schemes (see `dumbbill-mobile/README.md`, "iOS").

### AWS (step 10)
- Create a **separate AWS account for Dumbbill** (not mixed with personal use), enable two-factor, **never use the root login** for daily work, and set a **billing alert** (suggested at US$100 and US$150) on day one.
- Do not create resources until the deployment plan is agreed (`docs/03-engineering/architecture.md` §13). Infrastructure will be written as code later so nothing is clicked together by hand.
- Data stays in **India (Mumbai)** for privacy reasons (`security.md` §7).

## Open items still needing the owner's answer
Copied from `docs/07-open-questions.md` so they are not forgotten: brand/trademark/domain checks, plan prices, the 1–2 pilot retailers (and their printer and scanner models), and who the CA is.
