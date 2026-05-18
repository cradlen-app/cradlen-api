-- Add missing updated_at column to patient_org_enrollments
-- This column was omitted from the original CREATE TABLE migration and is required
-- for all mutable lifecycle models (status transitions PENDING → ACTIVE → DISCHARGED).
ALTER TABLE "patient_org_enrollments" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT NOW();
