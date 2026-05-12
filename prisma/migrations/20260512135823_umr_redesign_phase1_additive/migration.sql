-- AlterTable
ALTER TABLE "patient_journeys" ADD COLUMN     "care_path_id" UUID;

-- AlterTable
ALTER TABLE "patient_episodes" ADD COLUMN     "care_path_episode_id" UUID;

-- AlterTable
ALTER TABLE "visit_vitals" ADD COLUMN     "rbs_mmol_l" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "visit_encounters" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "visit_investigations" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "prescription_items" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patient_pregnancy_history" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patient_contraceptive_history" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patient_non_gyn_surgeries" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patient_history_notes" ADD COLUMN     "section_code" TEXT,
ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "national_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone_number" TEXT,
    "patient_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_guardians" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_paths" (
    "id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "organization_id" UUID,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "care_paths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_path_episodes" (
    "id" UUID NOT NULL,
    "care_path_id" UUID NOT NULL,
    "organization_id" UUID,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "care_path_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_obgyn_histories" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "husband_name" TEXT,
    "gynecological_baseline" JSONB,
    "gynecologic_procedures" JSONB,
    "screening_history" JSONB,
    "obstetric_summary" JSONB,
    "medical_chronic_illnesses" JSONB,
    "family_history" JSONB,
    "fertility_history" JSONB,
    "social_history" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_obgyn_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_obgyn_encounters" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "general_findings" JSONB,
    "cardiovascular_findings" JSONB,
    "respiratory_findings" JSONB,
    "menstrual_findings" JSONB,
    "abdominal_findings" JSONB,
    "pelvic_findings" JSONB,
    "breast_findings" JSONB,
    "extremities_findings" JSONB,
    "neurological_findings" JSONB,
    "skin_findings" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_obgyn_encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregnancy_journey_records" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "status" TEXT,
    "risk_level" TEXT,
    "lmp" DATE,
    "blood_group_rh" TEXT,
    "us_dating_date" DATE,
    "us_ga_weeks" INTEGER,
    "us_ga_days" INTEGER,
    "pregnancy_type" TEXT,
    "number_of_fetuses" INTEGER,
    "gender" TEXT,
    "delivery_plan" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pregnancy_journey_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregnancy_episode_records" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "anomaly_scan" JSONB,
    "gtt_result" JSONB,
    "trimester_summary" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pregnancy_episode_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_pregnancy_records" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "cervix_length_mm" DECIMAL(5,2),
    "cervix_dilatation_cm" DECIMAL(4,1),
    "cervix_effacement_pct" INTEGER,
    "cervix_position" TEXT,
    "membranes" TEXT,
    "warning_symptoms" JSONB,
    "fundal_height_cm" DECIMAL(5,2),
    "fundal_corresponds_ga" TEXT,
    "amniotic_fluid" TEXT,
    "placenta_location" TEXT,
    "placenta_grade" INTEGER,
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

    CONSTRAINT "visit_pregnancy_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guardians_national_id_key" ON "guardians"("national_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_patient_id_key" ON "guardians"("patient_id");

-- CreateIndex
CREATE INDEX "patient_guardians_guardian_id_idx" ON "patient_guardians"("guardian_id");

-- CreateIndex
CREATE INDEX "patient_guardians_patient_id_is_primary_idx" ON "patient_guardians"("patient_id", "is_primary");

-- CreateIndex
CREATE UNIQUE INDEX "patient_guardians_patient_id_guardian_id_key" ON "patient_guardians"("patient_id", "guardian_id");

-- CreateIndex
CREATE INDEX "care_paths_organization_id_specialty_id_idx" ON "care_paths"("organization_id", "specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "care_paths_specialty_id_organization_id_code_key" ON "care_paths"("specialty_id", "organization_id", "code");

-- CreateIndex
CREATE INDEX "care_path_episodes_organization_id_idx" ON "care_path_episodes"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "care_path_episodes_care_path_id_organization_id_code_key" ON "care_path_episodes"("care_path_id", "organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "patient_obgyn_histories_patient_id_key" ON "patient_obgyn_histories"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_obgyn_encounters_visit_id_key" ON "visit_obgyn_encounters"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "pregnancy_journey_records_journey_id_key" ON "pregnancy_journey_records"("journey_id");

-- CreateIndex
CREATE UNIQUE INDEX "pregnancy_episode_records_episode_id_key" ON "pregnancy_episode_records"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_pregnancy_records_visit_id_key" ON "visit_pregnancy_records"("visit_id");

-- CreateIndex
CREATE INDEX "patient_journeys_care_path_id_idx" ON "patient_journeys"("care_path_id");

-- CreateIndex
CREATE INDEX "patient_episodes_care_path_episode_id_idx" ON "patient_episodes"("care_path_episode_id");

-- CreateIndex
CREATE INDEX "patient_history_notes_patient_id_section_code_created_at_idx" ON "patient_history_notes"("patient_id", "section_code", "created_at");

-- AddForeignKey
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_care_path_id_fkey" FOREIGN KEY ("care_path_id") REFERENCES "care_paths"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_episodes" ADD CONSTRAINT "patient_episodes_care_path_episode_id_fkey" FOREIGN KEY ("care_path_episode_id") REFERENCES "care_path_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_encounters" ADD CONSTRAINT "visit_encounters_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_investigations" ADD CONSTRAINT "visit_investigations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_pregnancy_history" ADD CONSTRAINT "patient_pregnancy_history_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contraceptive_history" ADD CONSTRAINT "patient_contraceptive_history_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_non_gyn_surgeries" ADD CONSTRAINT "patient_non_gyn_surgeries_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_history_notes" ADD CONSTRAINT "patient_history_notes_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_paths" ADD CONSTRAINT "care_paths_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_paths" ADD CONSTRAINT "care_paths_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_paths" ADD CONSTRAINT "care_paths_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "care_paths"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_path_episodes" ADD CONSTRAINT "care_path_episodes_care_path_id_fkey" FOREIGN KEY ("care_path_id") REFERENCES "care_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_path_episodes" ADD CONSTRAINT "care_path_episodes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_obgyn_histories" ADD CONSTRAINT "patient_obgyn_histories_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_obgyn_histories" ADD CONSTRAINT "patient_obgyn_histories_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_obgyn_encounters" ADD CONSTRAINT "visit_obgyn_encounters_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_obgyn_encounters" ADD CONSTRAINT "visit_obgyn_encounters_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_journey_records" ADD CONSTRAINT "pregnancy_journey_records_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "patient_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_journey_records" ADD CONSTRAINT "pregnancy_journey_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_episode_records" ADD CONSTRAINT "pregnancy_episode_records_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "patient_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancy_episode_records" ADD CONSTRAINT "pregnancy_episode_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_pregnancy_records" ADD CONSTRAINT "visit_pregnancy_records_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_pregnancy_records" ADD CONSTRAINT "visit_pregnancy_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
