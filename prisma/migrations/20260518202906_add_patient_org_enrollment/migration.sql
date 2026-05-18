-- CreateEnum
CREATE TYPE "PatientOrgEnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISCHARGED');

-- CreateTable
CREATE TABLE "patient_org_enrollments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "PatientOrgEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_org_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_org_enrollments_patient_id_organization_id_is_delet_idx" ON "patient_org_enrollments"("patient_id", "organization_id", "is_deleted");

-- AddForeignKey
ALTER TABLE "patient_org_enrollments" ADD CONSTRAINT "patient_org_enrollments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_org_enrollments" ADD CONSTRAINT "patient_org_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTE: Partial unique index `patient_org_enrollment_patient_org_unique` is added
-- in the following migration (20260518203251_add_patient_org_enrollment) via raw SQL.
-- Prisma @@unique does not support WHERE clauses — same pattern as FormTemplate.is_active.
