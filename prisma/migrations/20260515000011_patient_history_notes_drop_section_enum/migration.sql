-- M11 — patient_history_notes_drop_section_enum
--
-- The `section` enum and `section_code` text column duplicated each other.
-- section_code is now the single key for the section, backfilled from section
-- for any pre-existing rows where it was null.

BEGIN;

UPDATE patient_history_notes
   SET section_code = section::TEXT
 WHERE section_code IS NULL;

ALTER TABLE patient_history_notes ALTER COLUMN section_code SET NOT NULL;

DROP INDEX IF EXISTS "patient_history_notes_patient_id_section_is_deleted_idx";

ALTER TABLE patient_history_notes DROP COLUMN section;

DROP TYPE IF EXISTS "PatientHistorySection";

COMMIT;
