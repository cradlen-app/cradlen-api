/*
  Warnings:

  - You are about to drop the column `complaint_categories` on the `visit_encounters` table. All the data in the column will be lost.
  - You are about to drop the column `complaint_duration` on the `visit_encounters` table. All the data in the column will be lost.
  - You are about to drop the column `complaint_onset` on the `visit_encounters` table. All the data in the column will be lost.
  - You are about to drop the column `complaint_severity` on the `visit_encounters` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "visit_encounters" DROP COLUMN "complaint_categories",
DROP COLUMN "complaint_duration",
DROP COLUMN "complaint_onset",
DROP COLUMN "complaint_severity",
ADD COLUMN     "chief_complaint_meta" JSONB;
