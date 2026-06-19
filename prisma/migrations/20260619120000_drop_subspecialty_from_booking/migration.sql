-- Decouple subspecialty from booking. Subspecialty stays a doctor credential
-- (subspecialties / profile_subspecialties / invitation_subspecialties tables
-- are untouched); these columns tied it to a visit row and a care path and are
-- now dead: care path is a doctor-only in-visit decision, and reception no
-- longer captures subspecialty at booking.

-- DropForeignKey
ALTER TABLE "care_paths" DROP CONSTRAINT "care_paths_subspecialty_id_fkey";

-- DropIndex
DROP INDEX "care_paths_scope_code_key";

-- DropIndex
DROP INDEX "care_paths_subspecialty_id_idx";

-- AlterTable
ALTER TABLE "care_paths" DROP COLUMN "subspecialty_id";

-- AlterTable
ALTER TABLE "visits" DROP COLUMN "subspecialty_code";

-- CreateIndex
CREATE UNIQUE INDEX "care_paths_scope_code_key" ON "care_paths"("specialty_id", "organization_id", "code");
