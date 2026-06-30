-- In-app "Help us improve Cradlen" feedback: staff/doctor suggestions captured
-- from the dashboard sidebar. Stored (not just emailed) so a future public
-- Features/Roadmap page can credit submitters who opted in (credit_consent).
-- Submitter identity/context is snapshotted (no FKs), so feedback survives
-- profile/org changes or deletion.

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('FEATURE', 'BUG', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWING', 'PLANNED', 'SHIPPED', 'DECLINED');

-- CreateTable
CREATE TABLE "feature_suggestions" (
    "id" UUID NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "credit_consent" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT NOT NULL,
    "profile_id" UUID,
    "organization_id" UUID,
    "branch_id" UUID,
    "role" TEXT,
    "page_url" TEXT,
    "app_version" TEXT,
    "locale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_suggestions_status_created_at_idx" ON "feature_suggestions"("status", "created_at");
