-- Multi-fetus surveillance for the pregnancy clinical surface.
--
-- Per-fetus fetal-lie + biometric fields move off visit_pregnancy_records (one
-- row per visit) into a new visit_fetal_records child (one row per fetus per
-- visit), so twins/triplets are first-class. The visit_pregnancy_records row
-- keeps maternal + shared fetal context (cervix, fundal, amniotic, placenta).
-- These tables were unused (pregnancy vertical deferred), so the column drops
-- are safe.

-- 1. Drop the per-fetus columns now owned by visit_fetal_records.
ALTER TABLE "visit_pregnancy_records" DROP COLUMN "ac_mm",
DROP COLUMN "bpd_mm",
DROP COLUMN "efw_g",
DROP COLUMN "engagement",
DROP COLUMN "fetal_heart_rate_bpm",
DROP COLUMN "fetal_lie",
DROP COLUMN "fetal_movements",
DROP COLUMN "fetal_rhythm",
DROP COLUMN "fl_mm",
DROP COLUMN "growth_impression",
DROP COLUMN "growth_percentile",
DROP COLUMN "hc_mm",
DROP COLUMN "presentation";

-- 2. Per-fetus surveillance row.
CREATE TABLE "visit_fetal_records" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "fetus_index" INTEGER NOT NULL DEFAULT 0,
    "fetus_label" TEXT,
    "gender" TEXT,
    "fetal_lie" TEXT,
    "presentation" TEXT,
    "engagement" TEXT,
    "fetal_heart_rate_bpm" INTEGER,
    "fetal_rhythm" TEXT,
    "fetal_movements" TEXT,
    "bpd_mm" DECIMAL(5,2),
    "hc_mm" DECIMAL(5,2),
    "ac_mm" DECIMAL(5,2),
    "fl_mm" DECIMAL(5,2),
    "efw_g" DECIMAL(7,2),
    "growth_percentile" INTEGER,
    "growth_impression" TEXT,
    "additional_findings" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_fetal_records_pkey" PRIMARY KEY ("id")
);

-- 3. Revision shadow table.
CREATE TABLE "visit_fetal_record_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "visit_fetal_record_revisions_pkey" PRIMARY KEY ("id")
);

-- 4. Indexes.
CREATE INDEX "visit_fetal_records_visit_id_is_deleted_idx" ON "visit_fetal_records"("visit_id", "is_deleted");
CREATE INDEX "visit_fetal_record_revisions_entity_id_version_idx" ON "visit_fetal_record_revisions"("entity_id", "version");

-- 5. Foreign keys.
ALTER TABLE "visit_fetal_records" ADD CONSTRAINT "visit_fetal_records_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_fetal_records" ADD CONSTRAINT "visit_fetal_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "visit_fetal_record_revisions" ADD CONSTRAINT "visit_fetal_record_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "visit_fetal_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_fetal_record_revisions" ADD CONSTRAINT "visit_fetal_record_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
