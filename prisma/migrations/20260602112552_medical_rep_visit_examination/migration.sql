-- CreateEnum
CREATE TYPE "MedicalRepVisitPurpose" AS ENUM ('PRODUCT_DETAILING', 'SAMPLE_DROP', 'CONFERENCE_INVITE', 'PRICE_UPDATE', 'FOLLOW_UP', 'COURTESY', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicalRepVisitOutcome" AS ENUM ('NONE', 'SCHEDULE_FOLLOWUP', 'SHARE_MATERIALS', 'NOT_INTERESTED');

-- AlterEnum
ALTER TYPE "BindingNamespace" ADD VALUE 'MEDICAL_REP_VISIT';

-- AlterTable
ALTER TABLE "medical_rep_visits" ADD COLUMN     "examination_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "follow_up_date" TIMESTAMP(3),
ADD COLUMN     "outcome" "MedicalRepVisitOutcome",
ADD COLUMN     "purpose" "MedicalRepVisitPurpose",
ADD COLUMN     "samples_received" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "medical_reps" ADD COLUMN     "specialty_focus" TEXT;
