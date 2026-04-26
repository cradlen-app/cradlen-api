-- ============================================================
-- Fix: add organization_id to staff_invitation_branches
-- Enables composite FK to branches(id, organization_id),
-- preventing cross-organization branch assignment
-- ============================================================
ALTER TABLE "staff_invitation_branches"
  ADD COLUMN "organization_id" UUID NOT NULL DEFAULT gen_random_uuid();

-- Remove placeholder default immediately (column is NOT NULL but will be
-- populated via the FK constraint enforcement — table is empty at this point)
ALTER TABLE "staff_invitation_branches"
  ALTER COLUMN "organization_id" DROP DEFAULT;

-- Drop old single-column FK on branch_id
ALTER TABLE "staff_invitation_branches"
  DROP CONSTRAINT "staff_invitation_branches_branch_id_fkey";

-- Add composite FK: (branch_id, organization_id) → branches(id, organization_id)
ALTER TABLE "staff_invitation_branches"
  ADD CONSTRAINT "staff_invitation_branches_branch_id_organization_id_fkey"
  FOREIGN KEY ("branch_id", "organization_id")
  REFERENCES "branches"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Fix: upgrade invitation FK to CASCADE on delete
-- (was RESTRICT — deleting an invitation must cascade to branches)
-- ============================================================
ALTER TABLE "staff_invitation_branches"
  DROP CONSTRAINT "staff_invitation_branches_invitation_id_fkey";

ALTER TABLE "staff_invitation_branches"
  ADD CONSTRAINT "staff_invitation_branches_invitation_id_fkey"
  FOREIGN KEY ("invitation_id")
  REFERENCES "staff_invitations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Fix: upgrade working_days FK to CASCADE on schedule delete
-- ============================================================
ALTER TABLE "working_days"
  DROP CONSTRAINT "working_days_schedule_id_fkey";

ALTER TABLE "working_days"
  ADD CONSTRAINT "working_days_schedule_id_fkey"
  FOREIGN KEY ("schedule_id")
  REFERENCES "working_schedules"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Fix: upgrade working_shifts FK to CASCADE on day delete
-- ============================================================
ALTER TABLE "working_shifts"
  DROP CONSTRAINT "working_shifts_day_id_fkey";

ALTER TABLE "working_shifts"
  ADD CONSTRAINT "working_shifts_day_id_fkey"
  FOREIGN KEY ("day_id")
  REFERENCES "working_days"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Fix: CHECK constraint ensuring WorkingSchedule has exactly
-- one parent (either staff_invitation_branch_id OR staff_id)
-- Cannot be expressed in Prisma schema — raw SQL only
-- ============================================================
ALTER TABLE "working_schedules"
  ADD CONSTRAINT "working_schedules_exactly_one_parent"
  CHECK (
    (staff_invitation_branch_id IS NOT NULL AND staff_id IS NULL)
    OR
    (staff_invitation_branch_id IS NULL AND staff_id IS NOT NULL)
  );

-- ============================================================
-- Fix: indexes on StaffInvitation for common query patterns
-- ============================================================
CREATE INDEX "staff_invitations_organization_id_status_idx"
  ON "staff_invitations"("organization_id", "status");

CREATE INDEX "staff_invitations_email_idx"
  ON "staff_invitations"("email");

CREATE INDEX "staff_invitations_expires_at_idx"
  ON "staff_invitations"("expires_at");

-- ============================================================
-- Fix: index on StaffInvitationBranch for invitation lookup
-- ============================================================
CREATE INDEX "staff_invitation_branches_invitation_id_idx"
  ON "staff_invitation_branches"("invitation_id");

-- ============================================================
-- Fix: indexes on WorkingDay for schedule lookup and uniqueness
-- ============================================================
CREATE INDEX "working_days_schedule_id_idx"
  ON "working_days"("schedule_id");

CREATE UNIQUE INDEX "working_days_schedule_id_day_of_week_key"
  ON "working_days"("schedule_id", "day_of_week");

-- ============================================================
-- Fix: index on WorkingShift for day lookup
-- ============================================================
CREATE INDEX "working_shifts_day_id_idx"
  ON "working_shifts"("day_id");

-- ============================================================
-- Fix: partial unique index — one PENDING invitation per org+email
-- Cannot be expressed in Prisma schema — raw SQL only
-- ============================================================
CREATE UNIQUE INDEX "staff_invitations_one_pending_per_org_email"
  ON "staff_invitations"("organization_id", "email")
  WHERE status = 'PENDING' AND is_deleted = false;
