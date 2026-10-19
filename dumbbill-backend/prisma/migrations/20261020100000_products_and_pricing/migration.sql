-- P1-4 Catalogue and pricing: categories, products, and the append-only price history.
-- Part 1 (structure) mirrors prisma/schema.prisma. Part 2 adds what Prisma cannot express: row-level security,
-- value checks, copying the category templates to existing businesses, and making price_history append-only.
-- Owned by the backend team; change by adding a new migration, never by editing this one.

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "default_hsn" VARCHAR(8),
    "default_gst_rate_bp" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "category_id" UUID,
    "variant" TEXT NOT NULL DEFAULT '',
    "sku" TEXT,
    "barcode" TEXT,
    "hsn" VARCHAR(8),
    "gst_rate_bp" INTEGER,
    "purchase_cost_paise" INTEGER,
    "image_key" TEXT,
    "thumb_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "mrp_paise" INTEGER NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ NOT NULL,
    "changed_by" UUID,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "product_categories_tenant_id_idx" ON "product_categories"("tenant_id");
-- CreateIndex
CREATE UNIQUE INDEX "product_categories_tenant_id_name_key" ON "product_categories"("tenant_id", "name");
-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");
-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_barcode_key" ON "products"("tenant_id", "barcode");
-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");
-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_name_brand_variant_key" ON "products"("tenant_id", "name", "brand", "variant");
-- CreateIndex
CREATE INDEX "price_history_tenant_id_product_id_effective_from_idx" ON "price_history"("tenant_id", "product_id", "effective_from" DESC);
-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Part 2
-- ---------------------------------------------------------------------------------------------------------

-- Businesses that existed before this migration get the starter categories (the same copy new sign-ups receive).
-- Done before row-level security is switched on, because the migration owner would otherwise see no rows.
INSERT INTO "product_categories" ("id", "tenant_id", "name", "default_hsn", "default_gst_rate_bp")
SELECT gen_random_uuid(), t."id", c."name", c."default_hsn", c."default_gst_rate_bp"
FROM "tenants" t CROSS JOIN "category_templates" c;

-- Value checks: whatever code writes a row, nonsense cannot be stored.
-- HSN is 4, 6 or 8 digits. The set of allowed GST rates changes by law, so the API owns that list; the database only
-- guards the range (0% to 100%).
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_name_chk" CHECK (btrim("name") <> '');
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_hsn_chk"
  CHECK ("default_hsn" IS NULL OR "default_hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_gst_chk"
  CHECK ("default_gst_rate_bp" IS NULL OR "default_gst_rate_bp" BETWEEN 0 AND 10000);

ALTER TABLE "products" ADD CONSTRAINT "products_name_chk" CHECK (btrim("name") <> '');
ALTER TABLE "products" ADD CONSTRAINT "products_hsn_chk"
  CHECK ("hsn" IS NULL OR "hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');
ALTER TABLE "products" ADD CONSTRAINT "products_gst_chk"
  CHECK ("gst_rate_bp" IS NULL OR "gst_rate_bp" BETWEEN 0 AND 10000);
ALTER TABLE "products" ADD CONSTRAINT "products_barcode_chk"
  CHECK ("barcode" IS NULL OR "barcode" ~ '^[A-Za-z0-9._-]{3,32}$');
ALTER TABLE "products" ADD CONSTRAINT "products_cost_chk"
  CHECK ("purchase_cost_paise" IS NULL OR "purchase_cost_paise" >= 0);

-- Prices are whole paise, positive, and the selling price may not exceed the MRP (selling above MRP is illegal in India).
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_amounts_chk"
  CHECK ("mrp_paise" > 0 AND "price_paise" > 0 AND "price_paise" <= "mrp_paise");
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_reason_chk" CHECK (btrim("reason") <> '');

-- ---------------------------------------------------------------------------------------------------------
-- Row-level security and grants. price_history joins audit_log as an APPEND-ONLY table: the app role may add rows but
-- never change or delete them (it is added to the list inside app_grant_defaults so a later migration cannot reopen it),
-- and a trigger stops everyone else too, including the table owner.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_grant_defaults(app_role name DEFAULT 'dumbbill_app')
  RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  append_only text[] := ARRAY['audit_log', 'price_history'];
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

SELECT enable_tenant_rls('product_categories');
SELECT enable_tenant_rls('products');
SELECT enable_tenant_rls('price_history');
SELECT app_grant_defaults();

CREATE OR REPLACE FUNCTION price_history_block_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'price_history is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER price_history_append_only
  BEFORE UPDATE OR DELETE ON "price_history"
  FOR EACH ROW EXECUTE FUNCTION price_history_block_changes();
