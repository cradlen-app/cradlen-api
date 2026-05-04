-- Rename Account → Organization across all tables and enums.
-- This migration is a semantic rename only; no business logic changes.

-- Drop join_code tables (removed from schema)
DROP TABLE IF EXISTS "join_code_branches";
DROP TABLE IF EXISTS "join_code_roles";
DROP TABLE IF EXISTS "join_codes";
DROP TYPE IF EXISTS "JoinCodeStatus";

-- Remove PHONE from VerificationChannel enum
ALTER TYPE "VerificationChannel" RENAME TO "VerificationChannel_old";
CREATE TYPE "VerificationChannel" AS ENUM ('EMAIL');
ALTER TABLE "verification_codes" ALTER COLUMN "channel" TYPE "VerificationChannel" USING "channel"::text::"VerificationChannel";
DROP TYPE "VerificationChannel_old";

-- Remove PHONE_LOGIN from VerificationPurpose enum
ALTER TYPE "VerificationPurpose" RENAME TO "VerificationPurpose_old";
CREATE TYPE "VerificationPurpose" AS ENUM ('SIGNUP', 'PASSWORD_RESET');
ALTER TABLE "verification_codes" ALTER COLUMN "purpose" TYPE "VerificationPurpose" USING "purpose"::text::"VerificationPurpose";
DROP TYPE "VerificationPurpose_old";

-- Rename AccountStatus → OrganizationStatus
ALTER TYPE "AccountStatus" RENAME TO "OrganizationStatus";

-- Rename table accounts → organizations
ALTER TABLE "accounts" RENAME TO "organizations";
DROP INDEX "accounts_status_is_deleted_idx";
CREATE INDEX "organizations_status_is_deleted_idx" ON "organizations"("status", "is_deleted");

-- Rename account_id → organization_id on branches
ALTER TABLE "branches" RENAME COLUMN "account_id" TO "organization_id";
ALTER TABLE "branches" RENAME CONSTRAINT "branches_account_id_fkey" TO "branches_organization_id_fkey";
DROP INDEX "branches_id_account_id_key";
CREATE UNIQUE INDEX "branches_id_organization_id_key" ON "branches"("id", "organization_id");
DROP INDEX "branches_account_id_is_deleted_idx";
CREATE INDEX "branches_organization_id_is_deleted_idx" ON "branches"("organization_id", "is_deleted");

-- Rename account_id → organization_id on profiles
ALTER TABLE "profiles" RENAME COLUMN "account_id" TO "organization_id";
ALTER TABLE "profiles" RENAME CONSTRAINT "profiles_account_id_fkey" TO "profiles_organization_id_fkey";
DROP INDEX "profiles_account_id_is_deleted_idx";
CREATE INDEX "profiles_organization_id_is_deleted_idx" ON "profiles"("organization_id", "is_deleted");
DROP INDEX "profiles_user_id_account_id_key";
CREATE UNIQUE INDEX "profiles_user_id_organization_id_key" ON "profiles"("user_id", "organization_id");

-- Rename account_id → organization_id on profile_branches
ALTER TABLE "profile_branches" RENAME COLUMN "account_id" TO "organization_id";
ALTER TABLE "profile_branches" DROP CONSTRAINT "profile_branches_branch_id_account_id_fkey";
ALTER TABLE "profile_branches" ADD CONSTRAINT "profile_branches_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "profile_branches_account_id_branch_id_idx";
CREATE INDEX "profile_branches_organization_id_branch_id_idx" ON "profile_branches"("organization_id", "branch_id");

-- Rename account_id → organization_id on subscriptions
ALTER TABLE "subscriptions" RENAME COLUMN "account_id" TO "organization_id";
ALTER TABLE "subscriptions" RENAME CONSTRAINT "subscriptions_account_id_fkey" TO "subscriptions_organization_id_fkey";
DROP INDEX "subscriptions_account_id_is_deleted_idx";
CREATE INDEX "subscriptions_organization_id_is_deleted_idx" ON "subscriptions"("organization_id", "is_deleted");

-- Rename account_id → organization_id on refresh_tokens
ALTER TABLE "refresh_tokens" RENAME COLUMN "account_id" TO "organization_id";

-- Add active_branch_id to refresh_tokens
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "active_branch_id" UUID;

-- Rename account_id → organization_id on invitations
ALTER TABLE "invitations" RENAME COLUMN "account_id" TO "organization_id";
ALTER TABLE "invitations" RENAME CONSTRAINT "invitations_account_id_fkey" TO "invitations_organization_id_fkey";
DROP INDEX "invitations_account_id_status_idx";
CREATE INDEX "invitations_organization_id_status_idx" ON "invitations"("organization_id", "status");

-- Rename account_id → organization_id on invitation_branches
ALTER TABLE "invitation_branches" RENAME COLUMN "account_id" TO "organization_id";
ALTER TABLE "invitation_branches" DROP CONSTRAINT "invitation_branches_branch_id_account_id_fkey";
ALTER TABLE "invitation_branches" ADD CONSTRAINT "invitation_branches_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "invitation_branches_account_id_branch_id_idx";
CREATE INDEX "invitation_branches_organization_id_branch_id_idx" ON "invitation_branches"("organization_id", "branch_id");

-- Rename max_accounts → max_organizations on subscription_plans
ALTER TABLE "subscription_plans" RENAME COLUMN "max_accounts" TO "max_organizations";

-- Add DayOfWeek enum
CREATE TYPE "DayOfWeek" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateTable working_schedules
CREATE TABLE "working_schedules" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "working_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "working_schedules_profile_id_branch_id_key" ON "working_schedules"("profile_id", "branch_id");
CREATE INDEX "working_schedules_profile_id_idx" ON "working_schedules"("profile_id");
ALTER TABLE "working_schedules" ADD CONSTRAINT "working_schedules_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "working_schedules" ADD CONSTRAINT "working_schedules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable working_days
CREATE TABLE "working_days" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "working_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "working_days_schedule_id_day_of_week_key" ON "working_days"("schedule_id", "day_of_week");
ALTER TABLE "working_days" ADD CONSTRAINT "working_days_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "working_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable working_shifts
CREATE TABLE "working_shifts" (
    "id" UUID NOT NULL,
    "day_id" UUID NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "working_shifts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "working_shifts" ADD CONSTRAINT "working_shifts_day_id_fkey" FOREIGN KEY ("day_id") REFERENCES "working_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;
