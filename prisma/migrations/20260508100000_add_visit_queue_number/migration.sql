-- Backfill: add queue_number column + composite index to visits.
-- Live DB already has these (added out-of-band); this migration uses
-- IF NOT EXISTS guards so it is a no-op there and applies cleanly on a
-- fresh database.

ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "queue_number" INTEGER;

-- Postgres truncates index identifiers to 63 bytes; this matches the live DB.
CREATE INDEX IF NOT EXISTS "visits_assigned_doctor_id_branch_id_checked_in_at_is_delete_idx"
    ON "visits" ("assigned_doctor_id", "branch_id", "checked_in_at", "is_deleted");
