-- CreateEnum
CREATE TYPE "SubscriptionPaymentItemKind" AS ENUM ('PLAN', 'ADD_ON');

-- AlterEnum
ALTER TYPE "SubscriptionPaymentPurpose" ADD VALUE 'COMBINED';

-- CreateTable
CREATE TABLE "subscription_payment_items" (
    "id" UUID NOT NULL,
    "subscription_payment_id" UUID NOT NULL,
    "kind" "SubscriptionPaymentItemKind" NOT NULL,
    "subscription_plan_id" UUID,
    "plan_price_id" UUID,
    "add_on_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_amount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_payment_items_subscription_payment_id_idx" ON "subscription_payment_items"("subscription_payment_id");

-- AddForeignKey
ALTER TABLE "subscription_payment_items" ADD CONSTRAINT "subscription_payment_items_subscription_payment_id_fkey" FOREIGN KEY ("subscription_payment_id") REFERENCES "subscription_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_items" ADD CONSTRAINT "subscription_payment_items_subscription_plan_id_fkey" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_items" ADD CONSTRAINT "subscription_payment_items_plan_price_id_fkey" FOREIGN KEY ("plan_price_id") REFERENCES "plan_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_items" ADD CONSTRAINT "subscription_payment_items_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
