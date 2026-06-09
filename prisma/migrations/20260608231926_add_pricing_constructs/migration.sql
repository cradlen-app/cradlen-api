-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterTable
ALTER TABLE "price_list_items" ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "price_lists" ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "price_list_item_tiers" (
    "id" UUID NOT NULL,
    "price_list_item_id" UUID NOT NULL,
    "min_quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_item_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_list_item_tiers_price_list_item_id_min_quantity_key" ON "price_list_item_tiers"("price_list_item_id", "min_quantity");

-- AddForeignKey
ALTER TABLE "price_list_item_tiers" ADD CONSTRAINT "price_list_item_tiers_price_list_item_id_fkey" FOREIGN KEY ("price_list_item_id") REFERENCES "price_list_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default price list per (organization, branch) scope. Partial
-- unique index — Prisma @@unique can't express the WHERE clause, and the
-- COALESCE collapses NULL branch_id so two org-level defaults also conflict.
CREATE UNIQUE INDEX "price_lists_one_default_per_scope"
  ON "price_lists" ("organization_id", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "is_default" = true AND "is_deleted" = false;
