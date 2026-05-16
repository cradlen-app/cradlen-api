-- M8 — visit_encounter_revisions + soft-delete
--
-- - VisitEncounterRevision shadow table (mirrors VisitObgynEncounterRevision).
-- - Soft-delete columns on visit_encounters and visit_vitals so the legal
--   record never disappears via DELETE.

CREATE TABLE visit_encounter_revisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id       UUID NOT NULL,
    version         INTEGER NOT NULL,
    snapshot        JSONB NOT NULL,
    changed_fields  JSONB NOT NULL,
    revised_by_id   UUID NOT NULL,
    revised_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revision_reason TEXT,
    CONSTRAINT visit_encounter_revisions_entity_fk
        FOREIGN KEY (entity_id) REFERENCES visit_encounters(id) ON DELETE CASCADE,
    CONSTRAINT visit_encounter_revisions_revised_by_fk
        FOREIGN KEY (revised_by_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX visit_encounter_revisions_entity_version_idx
    ON visit_encounter_revisions(entity_id, version);

ALTER TABLE visit_encounters ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE visit_encounters ADD COLUMN deleted_at TIMESTAMP(3);

ALTER TABLE visit_vitals ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE visit_vitals ADD COLUMN deleted_at TIMESTAMP(3);
