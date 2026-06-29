-- Blood group is a patient-level constant — its single source of truth is the
-- patient OB/GYN history (PatientObgynHistory.blood_group_rh). Drop the
-- duplicate free-text copy on the pregnancy journey record; the pregnancy
-- clinical surface now reads it read-only from history.

ALTER TABLE "pregnancy_journey_records" DROP COLUMN "blood_group_rh";
