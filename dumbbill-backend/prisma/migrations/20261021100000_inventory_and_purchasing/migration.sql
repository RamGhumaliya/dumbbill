-- P1-5 Suppliers, purchases, stock ledger with weighted average cost, transfers, supplier returns, alerts settings,
-- idempotency keys, document counters, and the audit-log hash chain.
-- Part 1 (structure) mirrors prisma/schema.prisma. Part 2 adds what Prisma cannot express: row-level security, value
-- checks, the append-only rules, and the unique index over batches.
-- Owned by the backend team; change by adding a new migration, never by editing this one.

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('PURCHASE', 'SALE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_CANCEL', 'SUPPLIER_RETURN', 'EXPIRY_WRITE_OFF');
-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "near_expiry_days" INTEGER NOT NULL DEFAULT 60;
-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "actor_role" TEXT,
ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB;
-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "phone" VARCHAR(15),
    "email" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "invoice_ref" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "other_cost_paise" INTEGER NOT NULL DEFAULT 0,
    "subtotal_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost_paise" INTEGER NOT NULL,
    "allocated_cost_paise" INTEGER NOT NULL,
    "line_total_paise" INTEGER NOT NULL,
    "batch_id" UUID,
    "batch_no" TEXT,
    "expiry_date" DATE,
    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stock_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_no" TEXT,
    "expiry_date" DATE,
    "qty_remaining" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stock_levels" (
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "value_paise" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("branch_id","product_id")
);
-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "type" "LedgerType" NOT NULL,
    "qty_delta" INTEGER NOT NULL,
    "value_delta_paise" BIGINT NOT NULL,
    "unit_cost_paise" INTEGER NOT NULL,
    "qty_after" INTEGER NOT NULL,
    "value_after_paise" BIGINT NOT NULL,
    "wac_after_paise" INTEGER NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID,
    "reason" TEXT,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" UUID,
    "received_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ,
    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "value_paise" BIGINT NOT NULL,
    "batch_no" TEXT,
    "expiry_date" DATE,
    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "debit_note_no" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "credit_total_paise" INTEGER NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "qty" INTEGER NOT NULL,
    "unit_credit_paise" INTEGER NOT NULL,
    "credit_paise" INTEGER NOT NULL,
    "cost_value_paise" BIGINT NOT NULL,
    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stock_thresholds" (
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "min_qty" INTEGER NOT NULL,
    CONSTRAINT "stock_thresholds_pkey" PRIMARY KEY ("branch_id","product_id")
);
-- CreateTable
CREATE TABLE "idempotency_keys" (
    "tenant_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id","scope","key")
);
-- CreateTable
CREATE TABLE "document_counters" (
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "next_no" INTEGER NOT NULL,
    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("tenant_id","kind")
);
-- CreateTable
CREATE TABLE "audit_chain" (
    "tenant_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "audit_id" UUID NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "sealed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_chain_pkey" PRIMARY KEY ("tenant_id","seq")
);
-- CreateIndex
CREATE INDEX "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");
-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_name_key" ON "suppliers"("tenant_id", "name");
-- CreateIndex
CREATE INDEX "purchases_tenant_id_created_at_idx" ON "purchases"("tenant_id", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "purchases_tenant_id_supplier_id_invoice_ref_key" ON "purchases"("tenant_id", "supplier_id", "invoice_ref");
-- CreateIndex
CREATE INDEX "purchase_lines_tenant_id_purchase_id_idx" ON "purchase_lines"("tenant_id", "purchase_id");
-- CreateIndex
CREATE INDEX "purchase_lines_tenant_id_product_id_idx" ON "purchase_lines"("tenant_id", "product_id");
-- CreateIndex
CREATE INDEX "stock_batches_tenant_id_branch_id_product_id_idx" ON "stock_batches"("tenant_id", "branch_id", "product_id");
-- CreateIndex
CREATE INDEX "stock_batches_tenant_id_expiry_date_idx" ON "stock_batches"("tenant_id", "expiry_date");
-- CreateIndex
CREATE INDEX "stock_levels_tenant_id_idx" ON "stock_levels"("tenant_id");
-- CreateIndex
CREATE INDEX "stock_ledger_tenant_id_branch_id_product_id_created_at_idx" ON "stock_ledger"("tenant_id", "branch_id", "product_id", "created_at");
-- CreateIndex
CREATE INDEX "stock_ledger_tenant_id_ref_type_ref_id_idx" ON "stock_ledger"("tenant_id", "ref_type", "ref_id");
-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_status_idx" ON "stock_transfers"("tenant_id", "status");
-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenant_id_transfer_id_idx" ON "stock_transfer_lines"("tenant_id", "transfer_id");
-- CreateIndex
CREATE INDEX "supplier_returns_tenant_id_supplier_id_idx" ON "supplier_returns"("tenant_id", "supplier_id");
-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_tenant_id_debit_note_no_key" ON "supplier_returns"("tenant_id", "debit_note_no");
-- CreateIndex
CREATE INDEX "supplier_return_lines_tenant_id_return_id_idx" ON "supplier_return_lines"("tenant_id", "return_id");
-- CreateIndex
CREATE INDEX "stock_thresholds_tenant_id_idx" ON "stock_thresholds"("tenant_id");
-- CreateIndex
CREATE UNIQUE INDEX "audit_chain_audit_id_key" ON "audit_chain"("audit_id");
-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Part 2
-- ---------------------------------------------------------------------------------------------------------

-- Money columns that sum to the stock value use BIGINT (a shop's stock can be worth more than Rs 2 crore in paise, which
-- would overflow a 32-bit integer). Per-line and per-bill amounts stay INTEGER and are capped below.

-- Value checks: whatever code writes a row, nonsense cannot be stored.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_near_expiry_days_chk" CHECK ("near_expiry_days" BETWEEN 1 AND 365);

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_chk" CHECK (btrim("name") <> '');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_gstin_chk"
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_phone_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{8,14}$');

-- A purchase: amounts are whole paise, capped at Rs 2 crore a bill (a guard against a typo becoming a real bill), and the
-- total is always the subtotal plus the extra costs.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amounts_chk"
  CHECK ("other_cost_paise" >= 0 AND "subtotal_paise" > 0 AND "total_paise" = "subtotal_paise" + "other_cost_paise"
         AND "total_paise" <= 2000000000);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_invoice_ref_chk" CHECK (btrim("invoice_ref") <> '');
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_amounts_chk"
  CHECK ("qty" > 0 AND "unit_cost_paise" >= 0 AND "allocated_cost_paise" >= 0
         AND "line_total_paise" = "qty"::bigint * "unit_cost_paise" + "allocated_cost_paise"
         AND "line_total_paise" <= 2000000000);

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_qty_chk" CHECK ("qty_remaining" >= 0);
-- One batch per (branch, product, batch number, expiry date): receiving the same batch again adds to it. A purchase with no
-- batch number and no expiry date shares one anonymous batch per product and branch.
CREATE UNIQUE INDEX "stock_batches_identity_key" ON "stock_batches"
  ("tenant_id", "branch_id", "product_id", COALESCE("batch_no", ''), COALESCE("expiry_date", DATE '9999-12-31'));

-- Stock never goes below zero, and when nothing is left nothing is worth anything (no stray value).
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_chk"
  CHECK ("qty" >= 0 AND "value_paise" >= 0 AND ("qty" > 0 OR "value_paise" = 0));

ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_chk"
  CHECK ("qty_delta" <> 0 AND "qty_after" >= 0 AND "value_after_paise" >= 0 AND "unit_cost_paise" >= 0 AND "wac_after_paise" >= 0
         -- units in add value, units out remove value: the two always move the same way
         AND (("qty_delta" > 0 AND "value_delta_paise" >= 0) OR ("qty_delta" < 0 AND "value_delta_paise" <= 0)));

ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_chk" CHECK ("qty" > 0 AND "value_paise" >= 0);
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_branches_chk" CHECK ("from_branch_id" <> "to_branch_id");
-- A transfer's status and its timestamps agree.
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_status_chk"
  CHECK (("status" = 'IN_TRANSIT' AND "received_at" IS NULL AND "cancelled_at" IS NULL)
      OR ("status" = 'RECEIVED' AND "received_at" IS NOT NULL AND "cancelled_at" IS NULL)
      OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "received_at" IS NULL));

ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_chk"
  CHECK (btrim("reason") <> '' AND "credit_total_paise" >= 0 AND "credit_total_paise" <= 2000000000);
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_chk"
  CHECK ("qty" > 0 AND "unit_credit_paise" >= 0 AND "credit_paise" = "qty"::bigint * "unit_credit_paise" AND "cost_value_paise" >= 0);

ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_chk" CHECK ("min_qty" >= 0);
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_chk" CHECK ("next_no" >= 1);

-- ---------------------------------------------------------------------------------------------------------
-- Row-level security and grants. stock_ledger and audit_chain join audit_log and price_history as APPEND-ONLY tables:
-- the app role may add rows but never change or delete them (they are added to the list inside app_grant_defaults so a
-- later migration cannot reopen them), and a trigger stops everyone else too, including the table owner.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_grant_defaults(app_role name DEFAULT 'dumbbill_app')
  RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  append_only text[] := ARRAY['audit_log', 'price_history', 'stock_ledger', 'audit_chain'];
  t text;
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON TABLE public._prisma_migrations FROM %I', app_role);
  END IF;
  FOREACH t IN ARRAY append_only LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM %I', t, app_role);
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION app_grant_defaults(name) FROM PUBLIC;

SELECT enable_tenant_rls('suppliers');
SELECT enable_tenant_rls('purchases');
SELECT enable_tenant_rls('purchase_lines');
SELECT enable_tenant_rls('stock_batches');
SELECT enable_tenant_rls('stock_levels');
SELECT enable_tenant_rls('stock_ledger');
SELECT enable_tenant_rls('stock_transfers');
SELECT enable_tenant_rls('stock_transfer_lines');
SELECT enable_tenant_rls('supplier_returns');
SELECT enable_tenant_rls('supplier_return_lines');
SELECT enable_tenant_rls('stock_thresholds');
SELECT enable_tenant_rls('idempotency_keys');
SELECT enable_tenant_rls('document_counters');
SELECT enable_tenant_rls('audit_chain');
SELECT app_grant_defaults();

CREATE OR REPLACE FUNCTION append_only_block_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER stock_ledger_append_only
  BEFORE UPDATE OR DELETE ON "stock_ledger"
  FOR EACH ROW EXECUTE FUNCTION append_only_block_changes();
CREATE TRIGGER audit_chain_append_only
  BEFORE UPDATE OR DELETE ON "audit_chain"
  FOR EACH ROW EXECUTE FUNCTION append_only_block_changes();
