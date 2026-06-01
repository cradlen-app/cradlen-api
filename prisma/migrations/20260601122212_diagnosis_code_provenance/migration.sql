-- CreateEnum
CREATE TYPE "DiagnosisCodeSource" AS ENUM ('SYSTEM', 'USER');

-- AlterTable
ALTER TABLE "diagnosis_codes" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "source" "DiagnosisCodeSource" NOT NULL DEFAULT 'SYSTEM';
