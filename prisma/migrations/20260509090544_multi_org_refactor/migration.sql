-- CreateEnum
CREATE TYPE "ExecutiveTitle" AS ENUM ('CEO', 'COO', 'CFO', 'CMO');

-- CreateEnum
CREATE TYPE "EngagementType" AS ENUM ('FULL_TIME', 'PART_TIME', 'ON_DEMAND', 'EXTERNAL_CONSULTANT');

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "procedure_id" UUID;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "engagement_type" "EngagementType" NOT NULL DEFAULT 'FULL_TIME',
ADD COLUMN     "executive_title" "ExecutiveTitle";

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "engagement_type" "EngagementType" NOT NULL DEFAULT 'FULL_TIME',
ADD COLUMN     "executive_title" "ExecutiveTitle";

-- CreateTable
CREATE TABLE "job_functions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_clinical" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_job_functions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "job_function_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_job_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedures" (
    "id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_specialties" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_specialties" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_specialties" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_job_functions" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "job_function_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_job_functions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_functions_name_key" ON "job_functions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "job_functions_code_key" ON "job_functions"("code");

-- CreateIndex
CREATE INDEX "profile_job_functions_job_function_id_idx" ON "profile_job_functions"("job_function_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_job_functions_profile_id_job_function_id_key" ON "profile_job_functions"("profile_id", "job_function_id");

-- CreateIndex
CREATE UNIQUE INDEX "procedures_code_key" ON "procedures"("code");

-- CreateIndex
CREATE INDEX "procedures_specialty_id_idx" ON "procedures"("specialty_id");

-- CreateIndex
CREATE INDEX "profile_specialties_specialty_id_idx" ON "profile_specialties"("specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_specialties_profile_id_specialty_id_key" ON "profile_specialties"("profile_id", "specialty_id");

-- CreateIndex
CREATE INDEX "organization_specialties_specialty_id_idx" ON "organization_specialties"("specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_specialties_organization_id_specialty_id_key" ON "organization_specialties"("organization_id", "specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_specialties_invitation_id_specialty_id_key" ON "invitation_specialties"("invitation_id", "specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_job_functions_invitation_id_job_function_id_key" ON "invitation_job_functions"("invitation_id", "job_function_id");

-- CreateIndex
CREATE INDEX "calendar_events_procedure_id_idx" ON "calendar_events"("procedure_id");

-- AddForeignKey
ALTER TABLE "profile_job_functions" ADD CONSTRAINT "profile_job_functions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_job_functions" ADD CONSTRAINT "profile_job_functions_job_function_id_fkey" FOREIGN KEY ("job_function_id") REFERENCES "job_functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_specialties" ADD CONSTRAINT "profile_specialties_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_specialties" ADD CONSTRAINT "profile_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_specialties" ADD CONSTRAINT "organization_specialties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_specialties" ADD CONSTRAINT "organization_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_specialties" ADD CONSTRAINT "invitation_specialties_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_specialties" ADD CONSTRAINT "invitation_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_job_functions" ADD CONSTRAINT "invitation_job_functions_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_job_functions" ADD CONSTRAINT "invitation_job_functions_job_function_id_fkey" FOREIGN KEY ("job_function_id") REFERENCES "job_functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
