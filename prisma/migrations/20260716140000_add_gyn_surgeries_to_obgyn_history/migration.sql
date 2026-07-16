-- Journey-synced gynecologic surgeries collection on the OB/GYN history
-- singleton (id-keyed JSON rows, mirroring `pregnancies`). Filed by the
-- surgical journey activation/close flows and editable via the history
-- sections embedded in the examination.
ALTER TABLE "patient_obgyn_histories" ADD COLUMN "gyn_surgeries" JSONB;
