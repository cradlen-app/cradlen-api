-- AlterTable
ALTER TABLE "medications" ADD COLUMN     "category" TEXT,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "default_dose_amount" DOUBLE PRECISION,
ADD COLUMN     "default_dose_frequency" TEXT,
ADD COLUMN     "default_dose_route" TEXT,
ADD COLUMN     "default_dose_unit" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "patient_org_enrollments" ALTER COLUMN "updated_at" DROP DEFAULT;
