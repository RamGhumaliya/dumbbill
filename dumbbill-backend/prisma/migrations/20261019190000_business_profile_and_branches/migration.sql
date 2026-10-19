-- P1-3 Business profile and branches.
-- Part 1 (structure) mirrors prisma/schema.prisma. Part 2 (values) adds database-level checks so that a bad
-- GSTIN shape, state code, invoice prefix or printer width can never be stored, whatever code writes it.
-- Owned by the backend team; change by adding a new migration, never by editing this one.

-- AlterTable: business profile on the tenant
ALTER TABLE "tenants" ADD COLUMN     "address_line" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "gstin" VARCHAR(15),
ADD COLUMN     "logo_key" TEXT,
ADD COLUMN     "phone" VARCHAR(15),
ADD COLUMN     "pincode" VARCHAR(6),
ADD COLUMN     "state_code" VARCHAR(2);

-- AlterTable: branch details. invoice_prefix is added nullable first so existing branches can be given one.
ALTER TABLE "branches" ADD COLUMN     "address_line" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "gstin" VARCHAR(15),
ADD COLUMN     "invoice_prefix" VARCHAR(6),
ADD COLUMN     "phone" VARCHAR(15),
ADD COLUMN     "pincode" VARCHAR(6),
ADD COLUMN     "printer_width_mm" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "state_code" VARCHAR(2);

-- ---------------------------------------------------------------------------------------------------------
-- Part 2: backfill and checks
-- ---------------------------------------------------------------------------------------------------------

-- Existing branches (made by P1-2 sign-ups) get a prefix "B1", "B2", ... per business, oldest first. The owner
-- changes it on the branch screen. `branches` has FORCE ROW LEVEL SECURITY, so the migration lifts it for the
-- backfill and restores it in the same transaction (a normal non-superuser table owner would otherwise see no rows).
ALTER TABLE "branches" NO FORCE ROW LEVEL SECURITY;
UPDATE "branches" b
SET "invoice_prefix" = 'B' || numbered.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS n FROM "branches"
) numbered
WHERE b.id = numbered.id;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;

ALTER TABLE "branches" ALTER COLUMN "invoice_prefix" SET NOT NULL;

-- CreateIndex: an invoice prefix is unique inside one business (two businesses may both use "FF").
CREATE UNIQUE INDEX "branches_tenant_id_invoice_prefix_key" ON "branches"("tenant_id", "invoice_prefix");

-- A state code must be a real GST state (gst_states is the reference list owned by the seed).
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_state_code_fkey"
  FOREIGN KEY ("state_code") REFERENCES "gst_states"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branches" ADD CONSTRAINT "branches_state_code_fkey"
  FOREIGN KEY ("state_code") REFERENCES "gst_states"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- GSTIN shape: 2-digit state, 10-character PAN, entity digit/letter, the letter Z, and a check character.
-- (The check-character arithmetic is verified by the API; the database guards the shape.)
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_gstin_shape_chk"
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
ALTER TABLE "branches" ADD CONSTRAINT "branches_gstin_shape_chk"
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

-- A GSTIN always starts with the state code of the place it is registered in.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_gstin_state_chk"
  CHECK ("gstin" IS NULL OR "state_code" IS NULL OR left("gstin", 2) = "state_code");
ALTER TABLE "branches" ADD CONSTRAINT "branches_gstin_state_chk"
  CHECK ("gstin" IS NULL OR "state_code" IS NULL OR left("gstin", 2) = "state_code");

-- Invoice prefix: 1 to 6 capital letters or digits. It is printed on invoices, so no spaces or symbols.
ALTER TABLE "branches" ADD CONSTRAINT "branches_invoice_prefix_chk"
  CHECK ("invoice_prefix" ~ '^[A-Z0-9]{1,6}$');

-- Receipt paper is 58 mm or 80 mm wide.
ALTER TABLE "branches" ADD CONSTRAINT "branches_printer_width_chk"
  CHECK ("printer_width_mm" IN (58, 80));

-- Six-digit Indian PIN code and a plain phone number (digits, optional leading +).
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_pincode_chk" CHECK ("pincode" IS NULL OR "pincode" ~ '^[1-9][0-9]{5}$');
ALTER TABLE "branches" ADD CONSTRAINT "branches_pincode_chk" CHECK ("pincode" IS NULL OR "pincode" ~ '^[1-9][0-9]{5}$');
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_phone_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{8,14}$');
ALTER TABLE "branches" ADD CONSTRAINT "branches_phone_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{8,14}$');

SELECT app_grant_defaults();
