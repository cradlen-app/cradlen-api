-- Track one-time use of verified password reset tokens.
ALTER TABLE "password_resets" ADD COLUMN IF NOT EXISTS "reset_at" TIMESTAMP(3);

-- Add lookup indexes used by staff, owner, and subscription queries.
CREATE INDEX IF NOT EXISTS "staff_organization_id_is_deleted_idx"
  ON "staff"("organization_id", "is_deleted");

CREATE INDEX IF NOT EXISTS "staff_user_id_organization_id_idx"
  ON "staff"("user_id", "organization_id");

CREATE INDEX IF NOT EXISTS "subscriptions_organization_id_is_deleted_idx"
  ON "subscriptions"("organization_id", "is_deleted");
