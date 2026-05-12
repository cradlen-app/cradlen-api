-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('VISIT', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'ENGAGED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GuardianRelation" AS ENUM ('SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'GUARDIAN_LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FormScope" AS ENUM ('BOOK_VISIT', 'ENCOUNTER', 'PATIENT_HISTORY');

-- CreateEnum
CREATE TYPE "FormTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN', 'SELECT', 'MULTISELECT', 'ENTITY_SEARCH', 'COMPUTED');

-- CreateEnum
CREATE TYPE "BindingNamespace" AS ENUM ('PATIENT', 'VISIT', 'INTAKE', 'GUARDIAN', 'MEDICAL_REP', 'LOOKUP', 'SYSTEM', 'COMPUTED');

-- CreateEnum
CREATE TYPE "MedicalRepVisitStatus" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "patient_contraceptive_history" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patient_episodes" ADD COLUMN     "care_path_episode_id" UUID;

-- AlterTable
ALTER TABLE "patient_history_notes" ADD COLUMN     "section_code" TEXT,
ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patient_journeys" ADD COLUMN     "care_path_id" UUID;

-- AlterTable
ALTER TABLE "patient_non_gyn_surgeries" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patient_pregnancy_history" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "marital_status" "MaritalStatus" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "prescription_items" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "visit_encounters" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "visit_investigations" ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "visit_vitals" ADD COLUMN     "rbs_mmol_l" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "visits" DROP COLUMN "visit_type",
ADD COLUMN     "appointment_type" "AppointmentType" NOT NULL;

-- DropEnum
DROP TYPE "VisitType";

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
    "relation_to_patient" "GuardianRelation" NOT NULL,
    "relationship_note" TEXT,
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

-- CreateTable
CREATE TABLE "form_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "FormScope" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FormTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMP(3),
    "specialty_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_sections" (
    "id" UUID NOT NULL,
    "form_template_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{"ui":{},"validation":{},"logic":{}}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "form_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FormFieldType" NOT NULL,
    "order" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "binding_namespace" "BindingNamespace",
    "binding_path" TEXT,
    "config" JSONB NOT NULL DEFAULT '{"ui":{},"validation":{},"logic":{}}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_reps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "national_id" TEXT,
    "phone_number" TEXT,
    "email" TEXT,
    "company_name" TEXT NOT NULL,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_reps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_rep_medications" (
    "id" UUID NOT NULL,
    "medical_rep_id" UUID NOT NULL,
    "medication_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_rep_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_rep_visits" (
    "id" UUID NOT NULL,
    "medical_rep_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "assigned_doctor_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "MedicalRepVisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "priority" "VisitPriority" NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_rep_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_rep_visit_medications" (
    "id" UUID NOT NULL,
    "medical_rep_visit_id" UUID NOT NULL,
    "medication_id" UUID NOT NULL,
    "discussion_notes" TEXT,

    CONSTRAINT "medical_rep_visit_medications_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "patient_obgyn_history_revisions_entity_id_version_idx" ON "patient_obgyn_history_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "visit_obgyn_encounter_revisions_entity_id_version_idx" ON "visit_obgyn_encounter_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "pregnancy_journey_record_revisions_entity_id_version_idx" ON "pregnancy_journey_record_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "pregnancy_episode_record_revisions_entity_id_version_idx" ON "pregnancy_episode_record_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "visit_pregnancy_record_revisions_entity_id_version_idx" ON "visit_pregnancy_record_revisions"("entity_id", "version");

-- CreateIndex
CREATE INDEX "form_templates_scope_status_is_deleted_idx" ON "form_templates"("scope", "status", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "form_templates_code_version_key" ON "form_templates"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "form_sections_form_template_id_code_key" ON "form_sections"("form_template_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_section_id_code_key" ON "form_fields"("section_id", "code");

-- CreateIndex
CREATE INDEX "medical_reps_organization_id_company_name_idx" ON "medical_reps"("organization_id", "company_name");

-- CreateIndex
CREATE INDEX "medical_reps_organization_id_is_deleted_idx" ON "medical_reps"("organization_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "medical_reps_organization_id_national_id_key" ON "medical_reps"("organization_id", "national_id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_rep_medications_medical_rep_id_medication_id_key" ON "medical_rep_medications"("medical_rep_id", "medication_id");

-- CreateIndex
CREATE INDEX "medical_rep_visits_organization_id_branch_id_scheduled_at_idx" ON "medical_rep_visits"("organization_id", "branch_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "medical_rep_visits_assigned_doctor_id_status_is_deleted_idx" ON "medical_rep_visits"("assigned_doctor_id", "status", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "medical_rep_visit_medications_medical_rep_visit_id_medicati_key" ON "medical_rep_visit_medications"("medical_rep_visit_id", "medication_id");

-- CreateIndex
CREATE INDEX "patient_episodes_care_path_episode_id_idx" ON "patient_episodes"("care_path_episode_id");

-- CreateIndex
CREATE INDEX "patient_history_notes_patient_id_section_code_created_at_idx" ON "patient_history_notes"("patient_id", "section_code", "created_at");

-- CreateIndex
CREATE INDEX "patient_journeys_care_path_id_idx" ON "patient_journeys"("care_path_id");

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

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "form_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_reps" ADD CONSTRAINT "medical_reps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_medications" ADD CONSTRAINT "medical_rep_medications_medical_rep_id_fkey" FOREIGN KEY ("medical_rep_id") REFERENCES "medical_reps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_medications" ADD CONSTRAINT "medical_rep_medications_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visits" ADD CONSTRAINT "medical_rep_visits_medical_rep_id_fkey" FOREIGN KEY ("medical_rep_id") REFERENCES "medical_reps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visits" ADD CONSTRAINT "medical_rep_visits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visits" ADD CONSTRAINT "medical_rep_visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visits" ADD CONSTRAINT "medical_rep_visits_assigned_doctor_id_fkey" FOREIGN KEY ("assigned_doctor_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visits" ADD CONSTRAINT "medical_rep_visits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visit_medications" ADD CONSTRAINT "medical_rep_visit_medications_medical_rep_visit_id_fkey" FOREIGN KEY ("medical_rep_visit_id") REFERENCES "medical_rep_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visit_medications" ADD CONSTRAINT "medical_rep_visit_medications_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique: at most one active version per form_template code at a time.
-- Prisma's @@unique does not support WHERE clauses; this is added as raw SQL
-- so rollback is just a flip of is_active rather than a destructive demotion.
CREATE UNIQUE INDEX "form_templates_code_active_unique"
  ON "form_templates" ("code")
  WHERE "is_active" = TRUE AND "is_deleted" = FALSE;
