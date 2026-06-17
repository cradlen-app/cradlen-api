-- Subspecialty feature + collapse the Profile/Invitation specialty M2M into a
-- single specialty_id FK column.
--
-- A doctor now holds ONE primary specialty (Profile.specialty_id, nullable —
-- non-clinical staff have none) and OPTIONALLY several subspecialties
-- (fellowships) via the new subspecialties catalog + profile_subspecialties /
-- invitation_subspecialties joins. CarePath gains an optional subspecialty scope
-- so the booking resolver can prefer a subspecialty-specific care path.
--
-- Backfill picks the earliest specialty link (by created_at) per profile/invitation,
-- mirroring 20260616051500_collapse_profile_role_jobfunction.

-- 1. New catalog + join tables.
CREATE TABLE "subspecialties" (
    "id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "subspecialties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profile_subspecialties" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "subspecialty_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_subspecialties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invitation_subspecialties" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "subspecialty_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_subspecialties_pkey" PRIMARY KEY ("id")
);

-- 2. Indexes + unique constraints for the new tables.
CREATE UNIQUE INDEX "subspecialties_code_key" ON "subspecialties"("code");
CREATE INDEX "subspecialties_specialty_id_idx" ON "subspecialties"("specialty_id");
CREATE INDEX "profile_subspecialties_subspecialty_id_idx" ON "profile_subspecialties"("subspecialty_id");
CREATE UNIQUE INDEX "profile_subspecialties_profile_id_subspecialty_id_key" ON "profile_subspecialties"("profile_id", "subspecialty_id");
CREATE INDEX "invitation_subspecialties_subspecialty_id_idx" ON "invitation_subspecialties"("subspecialty_id");
CREATE UNIQUE INDEX "invitation_subspecialties_invitation_id_subspecialty_id_key" ON "invitation_subspecialties"("invitation_id", "subspecialty_id");

-- 3. Foreign keys for the new tables.
ALTER TABLE "subspecialties" ADD CONSTRAINT "subspecialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_subspecialties" ADD CONSTRAINT "profile_subspecialties_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_subspecialties" ADD CONSTRAINT "profile_subspecialties_subspecialty_id_fkey" FOREIGN KEY ("subspecialty_id") REFERENCES "subspecialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitation_subspecialties" ADD CONSTRAINT "invitation_subspecialties_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitation_subspecialties" ADD CONSTRAINT "invitation_subspecialties_subspecialty_id_fkey" FOREIGN KEY ("subspecialty_id") REFERENCES "subspecialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Profile/Invitation single specialty_id column (nullable for the backfill).
ALTER TABLE "profiles"    ADD COLUMN "specialty_id" UUID;
ALTER TABLE "invitations" ADD COLUMN "specialty_id" UUID;

-- 5. Backfill from the old specialty join tables (earliest link by created_at wins).
UPDATE "profiles" p SET "specialty_id" = (
  SELECT ps."specialty_id" FROM "profile_specialties" ps
  WHERE ps."profile_id" = p."id" ORDER BY ps."created_at" ASC LIMIT 1
);
UPDATE "invitations" i SET "specialty_id" = (
  SELECT isp."specialty_id" FROM "invitation_specialties" isp
  WHERE isp."invitation_id" = i."id" ORDER BY isp."created_at" ASC LIMIT 1
);

-- 6. specialty_id FKs (optional → SET NULL) + indexes.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_specialty_id_fkey"
  FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_specialty_id_fkey"
  FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "profiles_specialty_id_idx" ON "profiles"("specialty_id");
CREATE INDEX "invitations_specialty_id_idx" ON "invitations"("specialty_id");

-- 7. Drop the now-redundant specialty join tables.
DROP TABLE "profile_specialties";
DROP TABLE "invitation_specialties";

-- 8. CarePath subspecialty scope: column, FK, index, widened unique key.
ALTER TABLE "care_paths" ADD COLUMN "subspecialty_id" UUID;
ALTER TABLE "care_paths" ADD CONSTRAINT "care_paths_subspecialty_id_fkey"
  FOREIGN KEY ("subspecialty_id") REFERENCES "subspecialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "care_paths_subspecialty_id_idx" ON "care_paths"("subspecialty_id");
DROP INDEX "care_paths_specialty_id_organization_id_code_key";
CREATE UNIQUE INDEX "care_paths_scope_code_key" ON "care_paths"("specialty_id", "subspecialty_id", "organization_id", "code");

-- 9. Visit.subspecialty_code (free-text capture, mirrors specialty_code).
ALTER TABLE "visits" ADD COLUMN "subspecialty_code" TEXT;
