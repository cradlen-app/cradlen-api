-- CreateTable
CREATE TABLE "calendar_event_assistants" (
    "id" UUID NOT NULL,
    "calendar_event_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_assistants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_event_assistants_profile_id_idx" ON "calendar_event_assistants"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_assistants_calendar_event_id_profile_id_key" ON "calendar_event_assistants"("calendar_event_id", "profile_id");

-- AddForeignKey
ALTER TABLE "calendar_event_assistants" ADD CONSTRAINT "calendar_event_assistants_calendar_event_id_fkey" FOREIGN KEY ("calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_assistants" ADD CONSTRAINT "calendar_event_assistants_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
