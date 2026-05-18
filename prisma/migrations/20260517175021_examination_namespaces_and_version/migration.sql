-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BindingNamespace" ADD VALUE 'VISIT_ENCOUNTER';
ALTER TYPE "BindingNamespace" ADD VALUE 'VISIT_VITALS';
ALTER TYPE "BindingNamespace" ADD VALUE 'VISIT_OBGYN_ENCOUNTER';
ALTER TYPE "BindingNamespace" ADD VALUE 'VISIT_INVESTIGATION';
ALTER TYPE "BindingNamespace" ADD VALUE 'PRESCRIPTION_ITEM';

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "examination_version" INTEGER NOT NULL DEFAULT 1;
