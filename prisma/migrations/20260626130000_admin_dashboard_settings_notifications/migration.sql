-- Admin dashboard support: a coarse role label on platform admins (Settings
-- "Admin team" badge), the singleton platform-settings row (payment-collection
-- accounts + global defaults), and the platform-wide admin notification feed
-- materialized from domain events.

-- CreateEnum
CREATE TYPE "PlatformAdminRole" AS ENUM ('SUPER_ADMIN', 'BILLING');

-- CreateEnum
CREATE TYPE "AdminNotificationType" AS ENUM ('ORGANIZATION_CREATED', 'SUBSCRIPTION_STARTED', 'PLAN_CHANGED', 'PAYMENT_SUBMITTED');

-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN     "role" "PlatformAdminRole" NOT NULL DEFAULT 'SUPER_ADMIN';

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" UUID NOT NULL,
    "instapay_handle" TEXT,
    "wallet_number" TEXT,
    "free_trial_days" INTEGER NOT NULL DEFAULT 14,
    "auto_verify_gateway_payments" BOOLEAN NOT NULL DEFAULT true,
    "default_currency" TEXT NOT NULL DEFAULT 'EGP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" UUID NOT NULL,
    "type" "AdminNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "organization_id" UUID,
    "related_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_notifications_is_read_created_at_idx" ON "admin_notifications"("is_read", "created_at");
