-- Type-ahead search on the catalogs uses Prisma `contains` + `mode: 'insensitive'`,
-- which compiles to `column ILIKE '%term%'`. A plain B-tree index cannot serve a
-- leading-wildcard ILIKE, so these were full scans on every keystroke. pg_trgm GIN
-- indexes on the raw columns let the planner satisfy the ILIKE via trigram match.
-- (Raw SQL — Prisma's schema DSL cannot express `USING gin (... gin_trgm_ops)`.)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DiagnosisCode — global, system-wide ICD-10 catalog (highest row count).
-- DiagnosisCodesService.search() matches code / description / keywords.
CREATE INDEX IF NOT EXISTS "diagnosis_codes_code_trgm_idx"
  ON "diagnosis_codes" USING gin ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "diagnosis_codes_description_trgm_idx"
  ON "diagnosis_codes" USING gin ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "diagnosis_codes_keywords_trgm_idx"
  ON "diagnosis_codes" USING gin ("keywords" gin_trgm_ops);

-- LabTest — org-scoped catalog. LabTestsService.search() matches name / code.
CREATE INDEX IF NOT EXISTS "lab_tests_name_trgm_idx"
  ON "lab_tests" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "lab_tests_code_trgm_idx"
  ON "lab_tests" USING gin ("code" gin_trgm_ops);

-- Medication — org-scoped catalog. MedicationsService.findAll() matches
-- name / generic_name / code.
CREATE INDEX IF NOT EXISTS "medications_name_trgm_idx"
  ON "medications" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "medications_generic_name_trgm_idx"
  ON "medications" USING gin ("generic_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "medications_code_trgm_idx"
  ON "medications" USING gin ("code" gin_trgm_ops);
