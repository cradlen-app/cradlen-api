/*
  Warnings:

  - You are about to drop the column `follow_up_in_days` on the `visits` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "visit_encounters" ADD COLUMN     "case_path" TEXT,
ADD COLUMN     "clinical_reasoning" TEXT,
ADD COLUMN     "complaint_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "complaint_duration" TEXT,
ADD COLUMN     "complaint_onset" TEXT,
ADD COLUMN     "complaint_severity" TEXT,
ADD COLUMN     "diagnosis_certainty" TEXT,
ADD COLUMN     "menstrual_findings" JSONB;

-- AlterTable
ALTER TABLE "visit_investigations" ADD COLUMN     "lab_facility" TEXT;

-- AlterTable
ALTER TABLE "visits" DROP COLUMN "follow_up_in_days",
ADD COLUMN     "follow_up_date" TIMESTAMP(3);
