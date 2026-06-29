-- Platform-admin auth audience: a third identity (alongside staff User and
-- PatientAccount) with no organization, authenticated via the `admin-jwt`
-- strategy. Adds the identity + audit tables, the ADMIN_LOGIN OTP purpose, and
-- the refresh-token / verification-code owner columns.

-- AlterEnum
ALTER TYPE "VerificationPurpose" ADD VALUE 'ADMIN_LOGIN';

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "platform_admin_id" UUID;

-- AlterTable
ALTER TABLE "verification_codes" ADD COLUMN     "admin_id" UUID;

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hashed" TEXT,
    "full_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE INDEX "admin_audit_log_admin_id_created_at_idx" ON "admin_audit_log"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_target_type_target_id_idx" ON "admin_audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_platform_admin_id_is_revoked_idx" ON "refresh_tokens"("platform_admin_id", "is_revoked");

-- CreateIndex
CREATE INDEX "verification_codes_admin_id_purpose_idx" ON "verification_codes"("admin_id", "purpose");

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_platform_admin_id_fkey" FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the "exactly one owner" CHECK from two owners (staff user / patient
-- account) to three (+ platform admin). Prisma does not track CHECK constraints,
-- so this swap is hand-written.
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_exactly_one_owner";
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_exactly_one_owner"
    CHECK (
        ("user_id" IS NOT NULL)::int
        + ("patient_account_id" IS NOT NULL)::int
        + ("platform_admin_id" IS NOT NULL)::int
        = 1
    );
