-- CreateEnum
CREATE TYPE "SubscriptionPaymentPurpose" AS ENUM ('PLAN', 'ADD_ON');

-- CreateEnum
CREATE TYPE "AddOnKind" AS ENUM ('BRANCH_BUNDLE', 'EXTRA_USER');

-- CreateEnum
CREATE TYPE "SubscriptionAddOnStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "add_on_id" UUID,
ADD COLUMN     "purpose" "SubscriptionPaymentPurpose" NOT NULL DEFAULT 'PLAN',
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "add_ons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AddOnKind" NOT NULL,
    "subscription_plan_id" UUID NOT NULL,
    "delta_branches" INTEGER NOT NULL DEFAULT 0,
    "delta_users" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "add_on_prices" (
    "id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "billing_interval" "BillingInterval" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "add_on_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_add_ons" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "SubscriptionAddOnStatus" NOT NULL DEFAULT 'ACTIVE',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "add_ons_code_key" ON "add_ons"("code");

-- CreateIndex
CREATE INDEX "add_ons_subscription_plan_id_is_active_idx" ON "add_ons"("subscription_plan_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "add_on_prices_add_on_id_billing_interval_currency_key" ON "add_on_prices"("add_on_id", "billing_interval", "currency");

-- CreateIndex
CREATE INDEX "subscription_add_ons_subscription_id_status_idx" ON "subscription_add_ons"("subscription_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_add_ons_subscription_id_add_on_id_key" ON "subscription_add_ons"("subscription_id", "add_on_id");

-- AddForeignKey
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_subscription_plan_id_fkey" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_add_ons" ADD CONSTRAINT "subscription_add_ons_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_add_ons" ADD CONSTRAINT "subscription_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Catalog swap (no real paid data): rename the legacy plan codes onto the new
-- codes in place so the seed upserts match the existing rows by code and all
-- FKs (subscriptions, subscription_payments) stay intact. The seed then resets
-- limits/prices and inserts the add-on catalog. No-ops on an already-swapped DB.
UPDATE "subscription_plans" SET "plan" = 'individual' WHERE "plan" = 'plus' AND NOT EXISTS (SELECT 1 FROM "subscription_plans" WHERE "plan" = 'individual');
UPDATE "subscription_plans" SET "plan" = 'center'     WHERE "plan" = 'pro' AND NOT EXISTS (SELECT 1 FROM "subscription_plans" WHERE "plan" = 'center');
UPDATE "subscription_plans" SET "plan" = 'network'    WHERE "plan" = 'enterprise' AND NOT EXISTS (SELECT 1 FROM "subscription_plans" WHERE "plan" = 'network');
UPDATE "subscription_plans" SET "max_organizations" = 1;
