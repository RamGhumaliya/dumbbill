-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_branches" INTEGER NOT NULL,
    "max_users" INTEGER NOT NULL,
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "price_monthly_paise" BIGINT,
    "price_yearly_paise" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_states" (
    "code" VARCHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "is_union_territory" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "gst_states_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "category_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_hsn" TEXT NOT NULL,
    "default_gst_rate_bp" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "category_templates_code_key" ON "category_templates"("code");
