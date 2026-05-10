-- CreateEnum
CREATE TYPE "PatientHistorySection" AS ENUM ('MENSTRUAL', 'GYNECOLOGIC_PROCEDURES', 'CONTRACEPTIVE', 'SCREENING', 'OBSTETRIC', 'MEDICAL', 'FAMILY', 'FERTILITY');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('PRIVATE_TO_ORG', 'SHARED_GLOBAL');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "family_history" JSONB,
ADD COLUMN     "fertility_history" JSONB,
ADD COLUMN     "gynecologic_procedures" JSONB,
ADD COLUMN     "gynecological_baseline" JSONB,
ADD COLUMN     "medical_chronic_illnesses" JSONB,
ADD COLUMN     "obstetric_summary" JSONB,
ADD COLUMN     "screening_history" JSONB,
ADD COLUMN     "social_history" JSONB;

-- CreateTable
CREATE TABLE "patient_allergies" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "allergy_to" TEXT NOT NULL,
    "associated_symptoms" TEXT,
    "severity" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_pregnancy_history" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "birth_date" DATE,
    "outcome" TEXT,
    "mode_of_delivery" TEXT,
    "gestational_age_weeks" INTEGER,
    "neonatal_outcome" TEXT,
    "complications" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_pregnancy_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_contraceptive_history" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "duration" TEXT,
    "complications" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_contraceptive_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_non_gyn_surgeries" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "surgery_name" TEXT NOT NULL,
    "surgery_date" DATE,
    "facility" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_non_gyn_surgeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_medications" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "medication_id" UUID,
    "drug_name" TEXT NOT NULL,
    "indication" TEXT,
    "dose" TEXT,
    "frequency" TEXT,
    "from_date" DATE,
    "to_date" DATE,
    "is_ongoing" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_history_notes" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "section" "PatientHistorySection" NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'PRIVATE_TO_ORG',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_history_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_allergies_patient_id_is_deleted_idx" ON "patient_allergies"("patient_id", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_pregnancy_history_patient_id_is_deleted_idx" ON "patient_pregnancy_history"("patient_id", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_contraceptive_history_patient_id_is_deleted_idx" ON "patient_contraceptive_history"("patient_id", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_non_gyn_surgeries_patient_id_is_deleted_idx" ON "patient_non_gyn_surgeries"("patient_id", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_medications_patient_id_is_deleted_idx" ON "patient_medications"("patient_id", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_medications_medication_id_idx" ON "patient_medications"("medication_id");

-- CreateIndex
CREATE INDEX "patient_history_notes_patient_id_section_is_deleted_idx" ON "patient_history_notes"("patient_id", "section", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_history_notes_patient_id_visibility_is_deleted_idx" ON "patient_history_notes"("patient_id", "visibility", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_history_notes_organization_id_idx" ON "patient_history_notes"("organization_id");

-- CreateIndex
CREATE INDEX "patient_history_notes_author_id_idx" ON "patient_history_notes"("author_id");

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_pregnancy_history" ADD CONSTRAINT "patient_pregnancy_history_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_pregnancy_history" ADD CONSTRAINT "patient_pregnancy_history_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contraceptive_history" ADD CONSTRAINT "patient_contraceptive_history_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contraceptive_history" ADD CONSTRAINT "patient_contraceptive_history_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_non_gyn_surgeries" ADD CONSTRAINT "patient_non_gyn_surgeries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_non_gyn_surgeries" ADD CONSTRAINT "patient_non_gyn_surgeries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_history_notes" ADD CONSTRAINT "patient_history_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_history_notes" ADD CONSTRAINT "patient_history_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_history_notes" ADD CONSTRAINT "patient_history_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
