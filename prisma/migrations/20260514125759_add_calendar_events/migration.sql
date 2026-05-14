-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('DAY_OFF', 'PROCEDURE', 'MEETING', 'GENERIC');

-- CreateEnum
CREATE TYPE "CalendarVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "event_type" "CalendarEventType" NOT NULL,
    "visibility" "CalendarVisibility" NOT NULL DEFAULT 'PRIVATE',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "procedure_id" UUID,
    "patient_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_profile_id_start_at_end_at_idx" ON "calendar_events"("profile_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "calendar_events_organization_id_branch_id_start_at_idx" ON "calendar_events"("organization_id", "branch_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_organization_id_visibility_start_at_idx" ON "calendar_events"("organization_id", "visibility", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_profile_id_event_type_is_deleted_idx" ON "calendar_events"("profile_id", "event_type", "is_deleted");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
