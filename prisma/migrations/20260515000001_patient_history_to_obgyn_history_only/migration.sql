-- M1 — patient_history_to_obgyn_history_only
--
-- Drops the 9 history snapshot columns (and husband_name) from `patients` and
-- backfills them into `patient_obgyn_histories`. PatientObgynHistory is now
-- the single home for the OB/GYN history snapshot and the `husband_name`
-- denormalization. Audit trail lives on `patient_obgyn_history_revisions`
-- (existing PR4 shadow table).

BEGIN;

-- 1) Backfill: upsert one PatientObgynHistory per Patient that has any of the
--    legacy columns populated. INSERT ... ON CONFLICT (patient_id) merges
--    legacy values into any pre-existing obgyn history row, but only writes
--    columns that the existing row hasn't already set (COALESCE prefers the
--    obgyn-history row when both exist).

INSERT INTO patient_obgyn_histories (
    id,
    patient_id,
    husband_name,
    gynecological_baseline,
    gynecologic_procedures,
    screening_history,
    obstetric_summary,
    medical_chronic_illnesses,
    family_history,
    fertility_history,
    social_history,
    version,
    updated_by_id,
    is_deleted,
    deleted_at,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    p.id,
    p.husband_name,
    p.gynecological_baseline,
    p.gynecologic_procedures,
    p.screening_history,
    p.obstetric_summary,
    p.medical_chronic_illnesses,
    p.family_history,
    p.fertility_history,
    p.social_history,
    1,
    NULL,
    false,
    NULL,
    NOW(),
    NOW()
FROM patients p
WHERE p.is_deleted = false
  AND (
        p.husband_name IS NOT NULL
     OR p.gynecological_baseline IS NOT NULL
     OR p.gynecologic_procedures IS NOT NULL
     OR p.screening_history IS NOT NULL
     OR p.obstetric_summary IS NOT NULL
     OR p.medical_chronic_illnesses IS NOT NULL
     OR p.family_history IS NOT NULL
     OR p.fertility_history IS NOT NULL
     OR p.social_history IS NOT NULL
  )
ON CONFLICT (patient_id) DO UPDATE SET
    husband_name              = COALESCE(patient_obgyn_histories.husband_name,              EXCLUDED.husband_name),
    gynecological_baseline    = COALESCE(patient_obgyn_histories.gynecological_baseline,    EXCLUDED.gynecological_baseline),
    gynecologic_procedures    = COALESCE(patient_obgyn_histories.gynecologic_procedures,    EXCLUDED.gynecologic_procedures),
    screening_history         = COALESCE(patient_obgyn_histories.screening_history,         EXCLUDED.screening_history),
    obstetric_summary         = COALESCE(patient_obgyn_histories.obstetric_summary,         EXCLUDED.obstetric_summary),
    medical_chronic_illnesses = COALESCE(patient_obgyn_histories.medical_chronic_illnesses, EXCLUDED.medical_chronic_illnesses),
    family_history            = COALESCE(patient_obgyn_histories.family_history,            EXCLUDED.family_history),
    fertility_history         = COALESCE(patient_obgyn_histories.fertility_history,         EXCLUDED.fertility_history),
    social_history            = COALESCE(patient_obgyn_histories.social_history,            EXCLUDED.social_history),
    updated_at                = NOW();

-- 2) Drop the legacy columns from patients.

ALTER TABLE patients
    DROP COLUMN husband_name,
    DROP COLUMN gynecological_baseline,
    DROP COLUMN gynecologic_procedures,
    DROP COLUMN screening_history,
    DROP COLUMN obstetric_summary,
    DROP COLUMN medical_chronic_illnesses,
    DROP COLUMN family_history,
    DROP COLUMN fertility_history,
    DROP COLUMN social_history;

COMMIT;
