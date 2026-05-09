/*
  Warnings:

  - You are about to drop the column `is_clinical` on the `invitations` table. All the data in the column will be lost.
  - You are about to drop the column `job_title` on the `invitations` table. All the data in the column will be lost.
  - You are about to drop the column `specialty` on the `invitations` table. All the data in the column will be lost.
  - You are about to drop the column `specialities` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `is_clinical` on the `profiles` table. All the data in the column will be lost.
  - You are about to drop the column `job_title` on the `profiles` table. All the data in the column will be lost.
  - You are about to drop the column `specialty` on the `profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "invitations" DROP COLUMN "is_clinical",
DROP COLUMN "job_title",
DROP COLUMN "specialty";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "specialities";

-- AlterTable
ALTER TABLE "profiles" DROP COLUMN "is_clinical",
DROP COLUMN "job_title",
DROP COLUMN "specialty";
