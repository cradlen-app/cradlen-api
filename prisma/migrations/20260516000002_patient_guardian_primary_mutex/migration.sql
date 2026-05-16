-- F4 — patient_guardian_primary_mutex
--
-- At most one primary link per (patient, relation_to_patient) on live rows.
-- Caller code already enforces this in-transaction; the partial unique is
-- belt-and-braces so any other write path that violates the invariant fails
-- loud at the DB.

-- Demote any pre-existing duplicates before adding the constraint. For each
-- (patient_id, relation_to_patient) group we keep the most recently updated
-- live primary and unset is_primary on the rest.
UPDATE patient_guardians pg
   SET is_primary = false
  FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY patient_id, relation_to_patient
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
      FROM patient_guardians
     WHERE is_primary = true AND is_deleted = false
  ) AS ranked
 WHERE ranked.id = pg.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX patient_guardians_one_primary_per_relation_unique
    ON patient_guardians(patient_id, relation_to_patient)
    WHERE is_primary = true AND is_deleted = false;
