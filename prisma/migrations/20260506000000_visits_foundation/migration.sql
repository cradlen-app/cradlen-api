-- Add new enums
CREATE TYPE "JourneyTemplateType" AS ENUM ('PREGNANCY', 'GENERAL_GYN', 'SURGICAL', 'CHRONIC_CONDITION');
CREATE TYPE "JourneyStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "EpisodeStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');
CREATE TYPE "VisitType" AS ENUM ('INITIAL', 'FOLLOW_UP', 'ROUTINE', 'EMERGENCY', 'PROCEDURE');
CREATE TYPE "VisitPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable specialties
CREATE TABLE "specialties" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "specialties_name_key" ON "specialties"("name");
CREATE UNIQUE INDEX "specialties_code_key" ON "specialties"("code");

-- CreateTable journey_templates
CREATE TABLE "journey_templates" (
    "id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "JourneyTemplateType" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "journey_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "journey_templates_name_key" ON "journey_templates"("name");
CREATE INDEX "journey_templates_specialty_id_idx" ON "journey_templates"("specialty_id");
ALTER TABLE "journey_templates" ADD CONSTRAINT "journey_templates_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable episode_templates
CREATE TABLE "episode_templates" (
    "id" UUID NOT NULL,
    "journey_template_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "episode_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "episode_templates_journey_template_id_idx" ON "episode_templates"("journey_template_id");
ALTER TABLE "episode_templates" ADD CONSTRAINT "episode_templates_journey_template_id_fkey" FOREIGN KEY ("journey_template_id") REFERENCES "journey_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable patients
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "national_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "husband_name" TEXT,
    "date_of_birth" DATE NOT NULL,
    "phone_number" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "patients_national_id_key" ON "patients"("national_id");
CREATE INDEX "patients_national_id_idx" ON "patients"("national_id");

-- CreateTable patient_journeys
CREATE TABLE "patient_journeys" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "journey_template_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "status" "JourneyStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "patient_journeys_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "patient_journeys_patient_id_organization_id_is_deleted_idx" ON "patient_journeys"("patient_id", "organization_id", "is_deleted");
CREATE INDEX "patient_journeys_organization_id_status_is_deleted_idx" ON "patient_journeys"("organization_id", "status", "is_deleted");
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_journey_template_id_fkey" FOREIGN KEY ("journey_template_id") REFERENCES "journey_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_journeys" ADD CONSTRAINT "patient_journeys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable patient_episodes
CREATE TABLE "patient_episodes" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "episode_template_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "patient_episodes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "patient_episodes_journey_id_is_deleted_idx" ON "patient_episodes"("journey_id", "is_deleted");
ALTER TABLE "patient_episodes" ADD CONSTRAINT "patient_episodes_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "patient_journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_episodes" ADD CONSTRAINT "patient_episodes_episode_template_id_fkey" FOREIGN KEY ("episode_template_id") REFERENCES "episode_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable visits
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "assigned_doctor_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "visit_type" "VisitType" NOT NULL,
    "priority" "VisitPriority" NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "checked_in_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visits_episode_id_is_deleted_idx" ON "visits"("episode_id", "is_deleted");
CREATE INDEX "visits_assigned_doctor_id_is_deleted_idx" ON "visits"("assigned_doctor_id", "is_deleted");
ALTER TABLE "visits" ADD CONSTRAINT "visits_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "patient_episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_assigned_doctor_id_fkey" FOREIGN KEY ("assigned_doctor_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
