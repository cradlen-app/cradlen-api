-- CreateTable
CREATE TABLE "patient_obgyn_history_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "patient_obgyn_history_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_obgyn_encounter_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "visit_obgyn_encounter_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregnancy_journey_record_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "pregnancy_journey_record_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregnancy_episode_record_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "pregnancy_episode_record_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_pregnancy_record_revisions" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_reason" TEXT,

    CONSTRAINT "visit_pregnancy_record_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_obgyn_history_revisions_entity_id_version_idx" ON "patient_obgyn_history_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "visit_obgyn_encounter_revisions_entity_id_version_idx" ON "visit_obgyn_encounter_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "pregnancy_journey_record_revisions_entity_id_version_idx" ON "pregnancy_journey_record_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "pregnancy_episode_record_revisions_entity_id_version_idx" ON "pregnancy_episode_record_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "visit_pregnancy_record_revisions_entity_id_version_idx" ON "visit_pregnancy_record_revisions"("entity_id", "version");

-- AddForeignKey
ALTER TABLE "patient_obgyn_history_revisions" ADD CONSTRAINT "patient_obgyn_history_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "patient_obgyn_histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_obgyn_history_revisions" ADD CONSTRAINT "patient_obgyn_history_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_obgyn_encounter_revisions" ADD CONSTRAINT "visit_obgyn_encounter_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "visit_obgyn_encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_obgyn_encounter_revisions" ADD CONSTRAINT "visit_obgyn_encounter_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_journey_record_revisions" ADD CONSTRAINT "pregnancy_journey_record_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "pregnancy_journey_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_journey_record_revisions" ADD CONSTRAINT "pregnancy_journey_record_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_episode_record_revisions" ADD CONSTRAINT "pregnancy_episode_record_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "pregnancy_episode_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_episode_record_revisions" ADD CONSTRAINT "pregnancy_episode_record_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_pregnancy_record_revisions" ADD CONSTRAINT "visit_pregnancy_record_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "visit_pregnancy_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_pregnancy_record_revisions" ADD CONSTRAINT "visit_pregnancy_record_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
