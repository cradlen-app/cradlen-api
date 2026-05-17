-- AlterEnum
ALTER TYPE "BindingNamespace" ADD VALUE 'PATIENT_OBGYN_HISTORY';

-- AlterTable
ALTER TABLE "form_sections" ADD COLUMN     "is_repeatable" BOOLEAN NOT NULL DEFAULT false;
