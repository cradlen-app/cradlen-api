/*
  Warnings:

  - You are about to drop the column `duration_days` on the `prescription_items` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "prescription_items" DROP COLUMN "duration_days",
ADD COLUMN     "duration" TEXT;
