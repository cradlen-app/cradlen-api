-- M9 — prescription_audit_and_integrity
--
-- - Add PrescriptionRevision + PrescriptionItemRevision shadow tables.
-- - Soft-delete on PrescriptionItem (Prescription already has it).
-- - @@unique([prescription_id, order]) to prevent duplicate item ordering.

CREATE TABLE prescription_revisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id       UUID NOT NULL,
    version         INTEGER NOT NULL,
    snapshot        JSONB NOT NULL,
    changed_fields  JSONB NOT NULL,
    revised_by_id   UUID NOT NULL,
    revised_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revision_reason TEXT,
    CONSTRAINT prescription_revisions_entity_fk
        FOREIGN KEY (entity_id) REFERENCES prescriptions(id) ON DELETE CASCADE,
    CONSTRAINT prescription_revisions_revised_by_fk
        FOREIGN KEY (revised_by_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX prescription_revisions_entity_version_idx
    ON prescription_revisions(entity_id, version);

CREATE TABLE prescription_item_revisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id       UUID NOT NULL,
    version         INTEGER NOT NULL,
    snapshot        JSONB NOT NULL,
    changed_fields  JSONB NOT NULL,
    revised_by_id   UUID NOT NULL,
    revised_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revision_reason TEXT,
    CONSTRAINT prescription_item_revisions_entity_fk
        FOREIGN KEY (entity_id) REFERENCES prescription_items(id) ON DELETE CASCADE,
    CONSTRAINT prescription_item_revisions_revised_by_fk
        FOREIGN KEY (revised_by_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX prescription_item_revisions_entity_version_idx
    ON prescription_item_revisions(entity_id, version);

ALTER TABLE prescription_items ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE prescription_items ADD COLUMN deleted_at TIMESTAMP(3);

-- Partial unique: live (non-deleted) items only — a soft-deleted item should
-- not block re-adding an item at the same order.
CREATE UNIQUE INDEX prescription_items_prescription_id_order_live_unique
    ON prescription_items(prescription_id, "order")
    WHERE is_deleted = false;
