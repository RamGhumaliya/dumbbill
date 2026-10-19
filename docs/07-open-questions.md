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
6. **Branches:** a default "Main branch" is made at signup; its details are filled in during P1-3 (below).

## Decisions made while building P1-4 (please confirm or change)
1. **GST rates a product may carry:** 0, 0.25, 3, 5, 18 and 40 percent (the slabs after the September 2025 reform). The retailer's CA must confirm the list before the first real invoice; it lives in one file (`domain/gst-rates.ts`). Old 12% and 28% are refused until the list is widened.
2. **HSN and GST are required only when the business has a GSTIN.** The category templates' HSN and GST (see `category-templates.ts`) are suggestions that pre-fill the form; the CA decides the real values per product.
3. **A variant is its own product** (own barcode, SKU, price). Barcode, SKU and name + brand + variant are each unique inside a business.
4. **A price can never be edited or back-dated.** A change needs a reason (3 to 200 characters), may start now or later (a scheduled price), and a selling price may never exceed the MRP. No per-branch prices yet.
5. **Cost is entered by hand on the product** until purchases and weighted average cost exist (P1-5). Only people with `products.cost.read` can see or set it; everyone else gets a response type with no cost fields at all.
6. **Pictures:** JPEG, PNG or WebP up to 2 MB, saved again as clean WebP (800 px and 160 px), private to signed-in people. **Virus scanning is not built** (needs a scanner we do not run); decide whether ClamAV is required before the first public upload.
7. **CSV import:** up to 2000 rows and 2 MB; good rows are added and bad rows reported (not all-or-nothing); categories named in the file are created when missing.
8. **Not built (say if you want any in Phase 1):** barcode generator, bulk edit, CSV export, per-branch prices, product images in the CSV.

## Decisions made while building P1-3 (please confirm or change)
1. **GSTIN is optional**, with a warning that only bills of supply can be issued without one (journey J1). It is checked for shape, check character and state, **not** against the GST portal.
2. **One PAN per business:** every branch GSTIN must carry the same PAN (characters 3 to 12) as the business GSTIN. A shop trading under two legal entities should be two businesses.
3. **Invoice prefix:** 1 to 6 capital letters or digits, unique inside a business; a new business starts with `MAIN` on its first branch. It will be locked after the first invoice is issued (Phase 2).
4. **The branch limit counts active branches only**; switched-off branches are free. The last active branch cannot be switched off. Branches are never deleted.
5. **Reading the profile and branches needs only a login** (the till prints them); changing them needs `settings.manage` (owner only by default).
6. **Logo:** PNG, JPEG or WebP, at most 2 MB, kept on the server's disk and shown only to signed-in people.
7. **Existing businesses** keep working: their branch got the prefix `B1`; the owner edits state and address in the branch screen (the checklist nudges them).

