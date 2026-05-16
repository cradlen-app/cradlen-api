-- M7 — visits_indexes_and_fk
--
-- - Drop redundant (assigned_doctor_id, is_deleted) — prefix-covered by the
--   4-tuple (assigned_doctor_id, branch_id, checked_in_at, is_deleted).
-- - Add (branch_id, scheduled_at) for agenda/calendar range queries.
-- - Change visits.form_template_id FK to RESTRICT so a template delete
--   cannot orphan a visit's legal contract anchor.

DROP INDEX IF EXISTS "visits_assigned_doctor_id_is_deleted_idx";

CREATE INDEX visits_branch_id_scheduled_at_idx
    ON visits(branch_id, scheduled_at);

ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_form_template_id_fkey;
ALTER TABLE visits ADD CONSTRAINT visits_form_template_id_fkey
    FOREIGN KEY (form_template_id) REFERENCES form_templates(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
