-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "balance_due" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(10,2);

-- Backfill outstanding balance for existing invoices.
UPDATE "invoices" SET "balance_due" = GREATEST(0, "total_amount" - "paid_amount");
