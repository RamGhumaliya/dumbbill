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
2. **Admin manages the team and the business settings by default** (`team.manage`, `settings.manage`). Owner's decision in the Phase 1 review; before it these were owner-only. Businesses created earlier keep their saved Admin role until the owner edits it.
3. **One owner per business** for now. Transferring ownership or adding a second owner is not built.
4. **Invitation links last 7 days.** An address that already has an account anywhere cannot be invited, and the answer never says why.
5. **Approval PIN rules:** 6 digits, 5 wrong tries lock it for the person trying (1 minute, doubling), obvious PINs refused.
6. **Branches:** a default "Main branch" is made at signup; its details are filled in during P1-3 (below).

## Answered in the Phase 1 review (owner, 20 Oct 2026)

1. **Negative stock:** a per-shop setting, default block (a sale that would take stock below zero is refused). Built with the till in Phase 2.
2. **Supplier payments:** later, with reports. The balance stays bills minus debit notes for now.
3. **Virus scan on uploads:** not required for now (pictures are decoded and re-saved). Revisit if PDFs or documents are ever accepted.
4. **Job runner:** BullMQ on the existing Redis, decided with the first job that needs it (Phase 2).
5. **Admin discount limit:** stays 20%. **Admin team and settings rights:** Admin gets both by default (see P1-2 decision 2).
6. **Before the till:** build the web team screens and the QR code for two-step setup.
7. **GST rate list:** keep 0, 0.25, 3, 5, 18 and 40% until the CA confirms it.

## Decisions made while building P1-7 (please confirm or change)

1. **The abilities of a person are edited as one list of tick boxes** that starts from the chosen role. Changing the role starts the list again from that role. The screen sends the difference to the role as "extras" and "taken away" (that is how the server stores it).
2. **Switching someone off asks first** (it signs them out at once); switching on and sending an invitation again do not.
3. **The owner and the signed-in person have no action buttons** in the people list, because the server refuses both. The e-mail address of an existing person cannot be changed (it is their sign-in name).
4. **The QR code uses two fixed colours** (`qr-ink`, `qr-paper`, the same in dark and light) so phone cameras can read it. It is drawn in the browser; the setup key is still shown as text.
5. **Switching on two-step sign-in needs the password** as well as the first code.

## Decisions made while building P1-6 (please confirm or change)

1. **Demo businesses are loaded by `pnpm db:seed:shops`,** a separate command (it runs the real services, which the Prisma seed runner cannot), and the demo password is the same for everyone (`Dumbbill-demo-2026`). It refuses production and remote databases. A year of **sales** is not loaded because invoices do not exist yet.
2. **Another business's branch is a 404 everywhere,** including the stock alerts filter, and a branch outside a person's scope is a 403 (the alerts route used to answer "nothing to report").
3. **The route-by-role table is a committed document** (`docs/api/permission-matrix.md`) that a test keeps in step with the code. Widening a role then shows up as a diff in review.
4. **Before Phase 2:** the four questions this item used to list (negative stock, supplier payments, job runner, virus scan) were answered in the Phase 1 review, above.
5. **Not yet decided, found by the security review (S4):** whether the Swagger pages (`/docs`) stay public in production, and whether production must refuse to start without `TRUST_PROXY_HOPS` (see the Phase 1 report, D-14 and D-15).

## Decisions made while building P1-5 (please confirm or change)

1. **Costing is weighted average, one average per product per branch**, kept as an exact total value so rounding never builds up. FIFO can come later (batches are already tracked).
2. **Stock cannot go below zero.** A shop-level "allow negative stock" policy is not built; decide before the till (Phase 2).
3. **Purchases are never edited.** Mistakes are fixed with a supplier return (debit note) or a stock count. A bill is capped at Rs 2 crore.
4. **Freight and other bill costs are spread over the lines by value** (landed cost), in whole paise that add up exactly.
5. **Expired stock cannot be bought:** a batch already expired is refused on a purchase. Expired batches are written off at the average cost; damaged goods use a count with the reason DAMAGE.
6. **Near-expiry window** defaults to 60 days per business (1 to 365, `settings.manage`).
7. **Supplier payments are not recorded.** The balance owed is bills minus debit-note credit. Say if payments belong in Phase 1.
8. **The daily low-stock/expiry e-mail digest is not built** (needs a job runner). The alerts screen and `GET /v1/stock/alerts` exist.
9. **Transfers are two steps** (send, then the other branch receives); goods in transit are in neither branch's stock; cost travels with them.
10. **The audit log is hash-chained** (tamper-evident, checked by `GET /v1/audit/verify`). Anchoring the latest hash outside the database (S3 Object Lock) waits for deployment work.
11. **Idempotency-Key is required** on purchases, returns, counts, write-offs and transfers. Old keys are not yet cleaned up.

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
