-- DropIndex
DROP INDEX "medical_rep_company_name_trgm_idx";

-- AlterTable
ALTER TABLE "guardians" ALTER COLUMN "national_id" DROP NOT NULL;
