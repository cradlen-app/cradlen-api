-- DropForeignKey
ALTER TABLE "patient_allergies" DROP CONSTRAINT "patient_allergies_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_allergies" DROP CONSTRAINT "patient_allergies_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_contraceptive_history" DROP CONSTRAINT "patient_contraceptive_history_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_contraceptive_history" DROP CONSTRAINT "patient_contraceptive_history_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_family_history" DROP CONSTRAINT "patient_family_history_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_medications" DROP CONSTRAINT "patient_medications_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_medications" DROP CONSTRAINT "patient_medications_medication_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_medications" DROP CONSTRAINT "patient_medications_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_non_gyn_surgeries" DROP CONSTRAINT "patient_non_gyn_surgeries_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_non_gyn_surgeries" DROP CONSTRAINT "patient_non_gyn_surgeries_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_pregnancy_history" DROP CONSTRAINT "patient_pregnancy_history_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "patient_pregnancy_history" DROP CONSTRAINT "patient_pregnancy_history_patient_id_fkey";

-- AlterTable
ALTER TABLE "patient_obgyn_histories" ADD COLUMN     "allergies" JSONB,
ADD COLUMN     "contraceptives" JSONB,
ADD COLUMN     "family_members" JSONB,
ADD COLUMN     "medications" JSONB,
ADD COLUMN     "non_gyn_surgeries" JSONB,
ADD COLUMN     "pregnancies" JSONB;

-- DropTable
DROP TABLE "patient_allergies";

-- DropTable
DROP TABLE "patient_contraceptive_history";

-- DropTable
DROP TABLE "patient_family_history";

-- DropTable
DROP TABLE "patient_medications";

-- DropTable
DROP TABLE "patient_non_gyn_surgeries";

-- DropTable
DROP TABLE "patient_pregnancy_history";
