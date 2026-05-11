-- CreateEnum
CREATE TYPE "VisitorKind" AS ENUM ('PATIENT', 'MEDICAL_REP');

-- AlterEnum
ALTER TYPE "FormSurface" ADD VALUE 'MEDICAL_REP_ENCOUNTER';

-- AlterEnum
BEGIN;
CREATE TYPE "VisitType_new" AS ENUM ('VISIT', 'FOLLOW_UP');
ALTER TABLE "visits" ALTER COLUMN "visit_type" TYPE "VisitType_new" USING ("visit_type"::text::"VisitType_new");
ALTER TYPE "VisitType" RENAME TO "VisitType_old";
ALTER TYPE "VisitType_new" RENAME TO "VisitType";
DROP TYPE "public"."VisitType_old";
COMMIT;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "medical_rep_id" UUID,
ADD COLUMN     "visitor_kind" "VisitorKind" NOT NULL DEFAULT 'PATIENT',
ALTER COLUMN "episode_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "medical_reps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "territory" TEXT,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_reps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_rep_encounters" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "follow_up_date" DATE,
    "signature_url" TEXT,
    "overall_outcome" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_rep_encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_rep_encounter_drugs" (
    "id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "medication_id" UUID NOT NULL,
    "samples_count" INTEGER NOT NULL DEFAULT 0,
    "materials_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_rep_encounter_drugs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medical_reps_organization_id_is_deleted_idx" ON "medical_reps"("organization_id", "is_deleted");

-- CreateIndex
CREATE INDEX "medical_reps_organization_id_company_full_name_idx" ON "medical_reps"("organization_id", "company", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "medical_rep_encounters_visit_id_key" ON "medical_rep_encounters"("visit_id");

-- CreateIndex
CREATE INDEX "medical_rep_encounter_drugs_medication_id_idx" ON "medical_rep_encounter_drugs"("medication_id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_rep_encounter_drugs_encounter_id_medication_id_key" ON "medical_rep_encounter_drugs"("encounter_id", "medication_id");

-- CreateIndex
CREATE INDEX "visits_medical_rep_id_is_deleted_idx" ON "visits"("medical_rep_id", "is_deleted");

-- CreateIndex
CREATE INDEX "visits_visitor_kind_branch_id_scheduled_at_idx" ON "visits"("visitor_kind", "branch_id", "scheduled_at");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_medical_rep_id_fkey" FOREIGN KEY ("medical_rep_id") REFERENCES "medical_reps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_reps" ADD CONSTRAINT "medical_reps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_encounters" ADD CONSTRAINT "medical_rep_encounters_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_encounter_drugs" ADD CONSTRAINT "medical_rep_encounter_drugs_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "medical_rep_encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_encounter_drugs" ADD CONSTRAINT "medical_rep_encounter_drugs_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce the visitor_kind <-> FK XOR at the DB level.
-- PATIENT visits MUST have episode_id and MUST NOT have medical_rep_id.
-- MEDICAL_REP visits MUST have medical_rep_id and MUST NOT have episode_id.
ALTER TABLE "visits" ADD CONSTRAINT "visits_visitor_kind_fks_check"
CHECK (
  (visitor_kind = 'PATIENT'     AND episode_id IS NOT NULL AND medical_rep_id IS NULL)
  OR
  (visitor_kind = 'MEDICAL_REP' AND medical_rep_id IS NOT NULL AND episode_id IS NULL)
);
