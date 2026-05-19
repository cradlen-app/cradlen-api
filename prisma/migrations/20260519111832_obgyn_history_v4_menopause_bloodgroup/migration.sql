/*
  Warnings:

  - You are about to drop the column `husband_name` on the `patient_obgyn_histories` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "BloodGroupRh" AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG');

-- AlterTable
ALTER TABLE "patient_obgyn_histories" DROP COLUMN "husband_name",
ADD COLUMN     "blood_group_rh" "BloodGroupRh",
ADD COLUMN     "menopause_history" JSONB;
