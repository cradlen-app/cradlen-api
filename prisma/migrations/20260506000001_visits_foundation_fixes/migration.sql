-- Fix 1: Add onDelete Cascade to FK relations in new models

-- JourneyTemplate.specialty_id
ALTER TABLE "journey_templates" DROP CONSTRAINT IF EXISTS "journey_templates_specialty_id_fkey";
ALTER TABLE "journey_templates" ADD CONSTRAINT "journey_templates_specialty_id_fkey"
  FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EpisodeTemplate.journey_template_id
ALTER TABLE "episode_templates" DROP CONSTRAINT IF EXISTS "episode_templates_journey_template_id_fkey";
ALTER TABLE "episode_templates" ADD CONSTRAINT "episode_templates_journey_template_id_fkey"
  FOREIGN KEY ("journey_template_id") REFERENCES "journey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PatientJourney.patient_id
ALTER TABLE "patient_journeys" DROP CONSTRAINT IF EXISTS "patient_journeys_patient_id_fkey";
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PatientJourney.organization_id
ALTER TABLE "patient_journeys" DROP CONSTRAINT IF EXISTS "patient_journeys_organization_id_fkey";
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PatientJourney.journey_template_id
ALTER TABLE "patient_journeys" DROP CONSTRAINT IF EXISTS "patient_journeys_journey_template_id_fkey";
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_journey_template_id_fkey"
  FOREIGN KEY ("journey_template_id") REFERENCES "journey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PatientJourney.created_by_id
ALTER TABLE "patient_journeys" DROP CONSTRAINT IF EXISTS "patient_journeys_created_by_id_fkey";
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PatientEpisode.journey_id
ALTER TABLE "patient_episodes" DROP CONSTRAINT IF EXISTS "patient_episodes_journey_id_fkey";
ALTER TABLE "patient_episodes" ADD CONSTRAINT "patient_episodes_journey_id_fkey"
  FOREIGN KEY ("journey_id") REFERENCES "patient_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PatientEpisode.episode_template_id
ALTER TABLE "patient_episodes" DROP CONSTRAINT IF EXISTS "patient_episodes_episode_template_id_fkey";
ALTER TABLE "patient_episodes" ADD CONSTRAINT "patient_episodes_episode_template_id_fkey"
  FOREIGN KEY ("episode_template_id") REFERENCES "episode_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Visit.episode_id
ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "visits_episode_id_fkey";
ALTER TABLE "visits" ADD CONSTRAINT "visits_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "patient_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Visit.assigned_doctor_id
ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "visits_assigned_doctor_id_fkey";
ALTER TABLE "visits" ADD CONSTRAINT "visits_assigned_doctor_id_fkey"
  FOREIGN KEY ("assigned_doctor_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Visit.branch_id
ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "visits_branch_id_fkey";
ALTER TABLE "visits" ADD CONSTRAINT "visits_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Visit.created_by_id
ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "visits_created_by_id_fkey";
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fix 2: Remove redundant index on national_id (unique constraint already creates one)
DROP INDEX IF EXISTS "patients_national_id_idx";

-- Fix 3: Add soft-delete fields to seed/lookup models

ALTER TABLE "specialties"
  ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

ALTER TABLE "journey_templates"
  ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

ALTER TABLE "episode_templates"
  ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- Fix 4: Add composite index on visits(branch_id, status, is_deleted)
CREATE INDEX IF NOT EXISTS "visits_branch_id_status_is_deleted_idx"
  ON "visits"("branch_id", "status", "is_deleted");
