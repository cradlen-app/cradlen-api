-- M10 — patient_history_strip_unused_audit
--
-- Drop `version` and `updated_by_id` from list-style patient history tables.
-- These columns were never wired to revision shadows; audit for these rows
-- lives on the PatientObgynHistory snapshot.

ALTER TABLE patient_pregnancy_history
    DROP COLUMN IF EXISTS version,
    DROP COLUMN IF EXISTS updated_by_id;

ALTER TABLE patient_contraceptive_history
    DROP COLUMN IF EXISTS version,
    DROP COLUMN IF EXISTS updated_by_id;

ALTER TABLE patient_non_gyn_surgeries
    DROP COLUMN IF EXISTS version,
    DROP COLUMN IF EXISTS updated_by_id;

ALTER TABLE patient_history_notes
    DROP COLUMN IF EXISTS version,
    DROP COLUMN IF EXISTS updated_by_id;
