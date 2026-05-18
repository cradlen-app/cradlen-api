-- Partial unique index: at most one live enrollment per (patient, org)
-- Prisma @@unique does not support WHERE clauses — raw SQL required (same pattern as FormTemplate.is_active)
CREATE UNIQUE INDEX "patient_org_enrollment_patient_org_unique"
ON "patient_org_enrollments"("patient_id", "organization_id")
WHERE "is_deleted" = FALSE;
