-- ============================================================
-- Fix: missing updated_at on users
-- ============================================================
ALTER TABLE "users" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ============================================================
-- Fix: refresh_tokens FK should CASCADE on user delete
-- ============================================================
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Fix: typo governate → governorate
-- ============================================================
ALTER TABLE "branches" RENAME COLUMN "governate" TO "governorate";

-- ============================================================
-- Fix: indexes on user_id for auth lookup tables
-- ============================================================
CREATE INDEX IF NOT EXISTS "email_verifications_user_id_idx" ON "email_verifications"("user_id");
CREATE INDEX IF NOT EXISTS "password_resets_user_id_idx" ON "password_resets"("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- ============================================================
-- Fix: typed status enums for organizations and branches
-- Existing rows must have values matching the enum labels.
-- Default seeded value is 'ACTIVE' — update any stale values first.
-- ============================================================
UPDATE "organizations" SET "status" = 'ACTIVE' WHERE "status" NOT IN ('ACTIVE', 'INACTIVE', 'SUSPENDED');
UPDATE "branches"      SET "status" = 'ACTIVE' WHERE "status" NOT IN ('ACTIVE', 'INACTIVE');

CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "BranchStatus"       AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "organizations"
  ALTER COLUMN "status" TYPE "OrganizationStatus"
  USING "status"::"OrganizationStatus";

ALTER TABLE "branches"
  ALTER COLUMN "status" TYPE "BranchStatus"
  USING "status"::"BranchStatus";

-- ============================================================
-- Fix: subscription lifecycle fields (status, starts_at, ends_at)
-- ============================================================
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED');

ALTER TABLE "subscriptions"
  ADD COLUMN "status"     "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN "starts_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "ends_at"    TIMESTAMP(3);

-- Back-fill: rows that already have trial_ends_at are TRIAL subscriptions
-- (status default already 'TRIAL', no further action needed)
