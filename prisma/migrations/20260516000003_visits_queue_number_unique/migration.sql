-- F6 — visits_queue_number_unique
--
-- queue_number is now assigned at booking time (F6). This partial unique
-- prevents two live visits from sharing the same queue position within a
-- given (doctor, branch, day) bucket. Soft-deleted rows and unset
-- queue_numbers (legacy / null) are excluded.

CREATE UNIQUE INDEX visits_queue_number_per_doctor_branch_day_unique
    ON visits(assigned_doctor_id, branch_id, DATE(scheduled_at), queue_number)
    WHERE is_deleted = false AND queue_number IS NOT NULL;
