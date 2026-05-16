-- M13 — calendar_event_constraints
--
-- - DB-level guard: end_at must be strictly after start_at.
-- - Drop the rarely-useful (profile_id, event_type, is_deleted) index —
--   calendar reads are date-range, not event_type-keyed.

ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_range_chk
    CHECK (end_at > start_at);

DROP INDEX IF EXISTS "calendar_events_profile_id_event_type_is_deleted_idx";
