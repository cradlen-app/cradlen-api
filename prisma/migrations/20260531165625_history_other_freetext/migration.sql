-- AlterTable
ALTER TABLE "patient_contraceptive_history" ADD COLUMN     "method_other" TEXT;

-- AlterTable
ALTER TABLE "patient_pregnancy_history" ADD COLUMN     "mode_of_delivery_other" TEXT,
ADD COLUMN     "neonatal_outcome_other" TEXT;
