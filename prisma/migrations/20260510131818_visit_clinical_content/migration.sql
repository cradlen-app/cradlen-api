-- CreateEnum
CREATE TYPE "LabTestCategory" AS ENUM ('LAB', 'IMAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('ORDERED', 'RESULTED', 'REVIEWED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvestigationResultSource" AS ENUM ('CLINIC', 'PATIENT', 'EXTERNAL_LAB');

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "follow_up_in_days" INTEGER,
ADD COLUMN     "follow_up_notes" TEXT;

-- CreateTable
CREATE TABLE "medications" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "generic_name" TEXT,
    "form" TEXT,
    "strength" TEXT,
    "added_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_tests" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LabTestCategory" NOT NULL,
    "specialty_id" UUID,
    "added_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_vitals" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "systolic_bp" INTEGER,
    "diastolic_bp" INTEGER,
    "pulse" INTEGER,
    "temperature_c" DECIMAL(4,1),
    "respiratory_rate" INTEGER,
    "spo2" INTEGER,
    "weight_kg" DECIMAL(5,2),
    "height_cm" DECIMAL(5,2),
    "bmi" DECIMAL(4,1),
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_encounters" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "chief_complaint" TEXT,
    "history_present_illness" TEXT,
    "general_findings" JSONB,
    "cardiovascular_findings" JSONB,
    "respiratory_findings" JSONB,
    "abdominal_findings" JSONB,
    "pelvic_findings" JSONB,
    "breast_findings" JSONB,
    "extremities_findings" JSONB,
    "neurological_findings" JSONB,
    "skin_findings" JSONB,
    "provisional_diagnosis" TEXT,
    "diagnosis_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_investigations" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "lab_test_id" UUID,
    "custom_test_name" TEXT,
    "notes" TEXT,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'ORDERED',
    "result_text" TEXT,
    "result_attachment_url" TEXT,
    "result_source" "InvestigationResultSource" NOT NULL DEFAULT 'CLINIC',
    "resulted_at" TIMESTAMP(3),
    "resulted_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" UUID,
    "external_ref" TEXT,
    "external_provider" TEXT,
    "ordered_by_id" UUID NOT NULL,
    "ordered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "prescribed_by_id" UUID NOT NULL,
    "prescribed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "medication_id" UUID,
    "custom_drug_name" TEXT,
    "dose" TEXT NOT NULL,
    "route" TEXT,
    "frequency" TEXT NOT NULL,
    "duration_days" INTEGER,
    "instructions" TEXT,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medications_organization_id_is_deleted_idx" ON "medications"("organization_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "medications_organization_id_code_key" ON "medications"("organization_id", "code");

-- CreateIndex
CREATE INDEX "lab_tests_organization_id_is_deleted_idx" ON "lab_tests"("organization_id", "is_deleted");

-- CreateIndex
CREATE INDEX "lab_tests_specialty_id_idx" ON "lab_tests"("specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_organization_id_code_key" ON "lab_tests"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "visit_vitals_visit_id_key" ON "visit_vitals"("visit_id");

-- CreateIndex
CREATE INDEX "visit_vitals_recorded_by_id_idx" ON "visit_vitals"("recorded_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_encounters_visit_id_key" ON "visit_encounters"("visit_id");

-- CreateIndex
CREATE INDEX "visit_investigations_visit_id_is_deleted_idx" ON "visit_investigations"("visit_id", "is_deleted");

-- CreateIndex
CREATE INDEX "visit_investigations_lab_test_id_idx" ON "visit_investigations"("lab_test_id");

-- CreateIndex
CREATE INDEX "visit_investigations_status_is_deleted_idx" ON "visit_investigations"("status", "is_deleted");

-- CreateIndex
CREATE INDEX "visit_investigations_ordered_by_id_idx" ON "visit_investigations"("ordered_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_visit_id_key" ON "prescriptions"("visit_id");

-- CreateIndex
CREATE INDEX "prescriptions_prescribed_by_id_idx" ON "prescriptions"("prescribed_by_id");

-- CreateIndex
CREATE INDEX "prescription_items_prescription_id_idx" ON "prescription_items"("prescription_id");

-- CreateIndex
CREATE INDEX "prescription_items_medication_id_idx" ON "prescription_items"("medication_id");

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_encounters" ADD CONSTRAINT "visit_encounters_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_investigations" ADD CONSTRAINT "visit_investigations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_investigations" ADD CONSTRAINT "visit_investigations_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_investigations" ADD CONSTRAINT "visit_investigations_resulted_by_id_fkey" FOREIGN KEY ("resulted_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_investigations" ADD CONSTRAINT "visit_investigations_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_investigations" ADD CONSTRAINT "visit_investigations_ordered_by_id_fkey" FOREIGN KEY ("ordered_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescribed_by_id_fkey" FOREIGN KEY ("prescribed_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
