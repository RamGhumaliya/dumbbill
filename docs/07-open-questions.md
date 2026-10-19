# Open Questions

Answered questions are recorded in `docs/README.md` (Locked decisions).

## Still open (none block development)
1. **Brand checks for "Dumbbill":** trademark search (India, class 9/42), domain (dumbbill.in / .com / .app), Play Store and App Store name availability, social handles.
2. **Pricing numbers** for Starter / Growth / Pro (limits are seeded: 1/3, 3/10, 10/30). Plans are data-driven.
3. **Pilot retailers:** names and contact for the 1–2 shops, and which printer and scanner models they use (needed for the printer matrix in Phase 2).
4. **CA:** who will validate the GST invoice and report, and by when (before Phase 2 ends).

## Deferred by the owner
Deployment, AWS account, domain purchase, Razorpay/SES/FCM/Sentry accounts, store accounts, release automation, support console. Checklist will be `docs/accounts-checklist.md` (P0-7).

## Decisions made while building P1-2 (please confirm or change)
These were not specified in the plan, so a default was chosen. All are editable per business or easy to change in code.
1. **Starting discount limits:** Cashier 5% (from the plan), Admin 20% (chosen), Owner unlimited. Tell us if Admin should differ.
2. **Admin does not manage the team or business settings by default** (`team.manage`, `settings.manage` are owner-only until the owner grants them).
3. **One owner per business** for now. Transferring ownership or adding a second owner is not built.
4. **Invitation links last 7 days.** An address that already has an account anywhere cannot be invited, and the answer never says why.
5. **Approval PIN rules:** 6 digits, 5 wrong tries lock it for the person trying (1 minute, doubling), obvious PINs refused.
6. **Branches:** only a name and an "active" flag exist so far (plus a default "Main branch" at signup); the full branch details and screens are P1-3.

