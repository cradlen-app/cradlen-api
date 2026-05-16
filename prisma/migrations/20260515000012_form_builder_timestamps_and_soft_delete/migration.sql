-- M12 — form_builder_timestamps_and_soft_delete
--
-- FormSection / FormField had `is_deleted` but no `deleted_at`, and no
-- created_at/updated_at. Bring them in line with the rest of the schema.

ALTER TABLE form_sections
    ADD COLUMN deleted_at TIMESTAMP(3),
    ADD COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE form_fields
    ADD COLUMN deleted_at TIMESTAMP(3),
    ADD COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
