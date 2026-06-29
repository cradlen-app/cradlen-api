-- Surgical journey clinical surface — the second journey care path
-- (OBGYN_SURGICAL). Adds three scoped record tables + their revision shadows,
-- and three SURGICAL_* binding namespaces. Mirrors the pregnancy vertical.

-- AlterEnum
ALTER TYPE "BindingNamespace" ADD VALUE 'SURGICAL_JOURNEY';
ALTER TYPE "BindingNamespace" ADD VALUE 'SURGICAL_EPISODE';
ALTER TYPE "BindingNamespace" ADD VALUE 'SURGICAL_VISIT';

-- CreateTable
CREATE TABLE "surgical_journey_records" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "status" TEXT,
    "procedure_id" UUID,
    "procedure_code" TEXT,
    "procedure_name" TEXT,
    "indication" TEXT,
    "planned_date" DATE,
    "surgery_date" DATE,
    "anesthesia_type" TEXT,
    "urgency" TEXT,
    "source_pregnancy_journey_id" UUID,
    "outcome" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surgical_journey_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgical_episode_records" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "preop_assessment" JSONB,
    "operative_summary" JSONB,
    "postop_summary" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surgical_episode_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_surgical_records" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "procedure_performed" TEXT,
    "findings" JSONB,
    "estimated_blood_loss_ml" INTEGER,
    "duration_minutes" INTEGER,
    "complications" JSONB,
    "wound_status" TEXT,
    "drains" TEXT,
    "recovery_notes" TEXT,
    "additional_findings" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_surgical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgical_journey_record_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "surgical_journey_record_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgical_episode_record_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "surgical_episode_record_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_surgical_record_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "visit_surgical_record_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "surgical_journey_records_journey_id_key" ON "surgical_journey_records"("journey_id");

-- CreateIndex
CREATE UNIQUE INDEX "surgical_episode_records_episode_id_key" ON "surgical_episode_records"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_surgical_records_visit_id_key" ON "visit_surgical_records"("visit_id");

-- CreateIndex
CREATE INDEX "surgical_journey_record_revisions_entity_id_version_idx" ON "surgical_journey_record_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "surgical_episode_record_revisions_entity_id_version_idx" ON "surgical_episode_record_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "visit_surgical_record_revisions_entity_id_version_idx" ON "visit_surgical_record_revisions"("entity_id", "version");

-- AddForeignKey
ALTER TABLE "surgical_journey_records" ADD CONSTRAINT "surgical_journey_records_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "patient_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_journey_records" ADD CONSTRAINT "surgical_journey_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_episode_records" ADD CONSTRAINT "surgical_episode_records_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "patient_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_episode_records" ADD CONSTRAINT "surgical_episode_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_surgical_records" ADD CONSTRAINT "visit_surgical_records_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_surgical_records" ADD CONSTRAINT "visit_surgical_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_journey_record_revisions" ADD CONSTRAINT "surgical_journey_record_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "surgical_journey_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_journey_record_revisions" ADD CONSTRAINT "surgical_journey_record_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_episode_record_revisions" ADD CONSTRAINT "surgical_episode_record_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "surgical_episode_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgical_episode_record_revisions" ADD CONSTRAINT "surgical_episode_record_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_surgical_record_revisions" ADD CONSTRAINT "visit_surgical_record_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "visit_surgical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_surgical_record_revisions" ADD CONSTRAINT "visit_surgical_record_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
