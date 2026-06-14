-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentProvider" AS ENUM ('INSTAPAY', 'WALLET');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'AWAITING_VERIFICATION', 'VERIFIED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "subscription_plan_id" UUID NOT NULL,
    "billing_interval" "BillingInterval" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "subscription_plan_id" UUID NOT NULL,
    "plan_price_id" UUID,
    "provider" "SubscriptionPaymentProvider" NOT NULL,
    "provider_ref" TEXT,
    "billing_interval" "BillingInterval" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_by_id" UUID,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payment_proofs" (
    "id" UUID NOT NULL,
    "subscription_payment_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_subscription_plan_id_billing_interval_currency_key" ON "plan_prices"("subscription_plan_id", "billing_interval", "currency");

-- CreateIndex
CREATE INDEX "subscription_payments_organization_id_status_idx" ON "subscription_payments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "subscription_payment_proofs_subscription_payment_id_is_dele_idx" ON "subscription_payment_proofs"("subscription_payment_id", "is_deleted");

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_subscription_plan_id_fkey" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_plan_id_fkey" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_price_id_fkey" FOREIGN KEY ("plan_price_id") REFERENCES "plan_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_proofs" ADD CONSTRAINT "subscription_payment_proofs_subscription_payment_id_fkey" FOREIGN KEY ("subscription_payment_id") REFERENCES "subscription_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

