-- M3 — working_shift_minutes
--
-- WorkingShift times move from `String` (HH:MM) to `Int` minutes-from-midnight.
-- Orderable, CHECK-constrained, locale-free.

BEGIN;

ALTER TABLE working_shifts ADD COLUMN start_minute INT;
ALTER TABLE working_shifts ADD COLUMN end_minute INT;

UPDATE working_shifts SET
    start_minute = (SPLIT_PART(start_time, ':', 1)::INT * 60)
                 + SPLIT_PART(start_time, ':', 2)::INT,
    end_minute   = (SPLIT_PART(end_time, ':', 1)::INT * 60)
                 + SPLIT_PART(end_time, ':', 2)::INT;

ALTER TABLE working_shifts ALTER COLUMN start_minute SET NOT NULL;
ALTER TABLE working_shifts ALTER COLUMN end_minute SET NOT NULL;

ALTER TABLE working_shifts DROP COLUMN start_time;
ALTER TABLE working_shifts DROP COLUMN end_time;

ALTER TABLE working_shifts ADD CONSTRAINT working_shifts_start_range_chk
    CHECK (start_minute >= 0 AND start_minute <= 1439);
ALTER TABLE working_shifts ADD CONSTRAINT working_shifts_end_range_chk
    CHECK (end_minute >= 1 AND end_minute <= 1440);
ALTER TABLE working_shifts ADD CONSTRAINT working_shifts_range_chk
    CHECK (end_minute > start_minute);

COMMIT;
