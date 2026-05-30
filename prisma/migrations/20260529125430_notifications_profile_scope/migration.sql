/*
  Warnings:

  - You are about to drop the column `user_id` on the `notifications` table. All the data in the column will be lost.
  - Added the required column `profile_id` to the `notifications` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";

-- DropIndex
DROP INDEX "notifications_user_id_category_is_deleted_idx";

-- DropIndex
DROP INDEX "notifications_user_id_code_is_deleted_idx";

-- DropIndex
DROP INDEX "notifications_user_id_is_read_is_deleted_idx";

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "user_id",
ADD COLUMN     "profile_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "notifications_profile_id_is_read_is_deleted_idx" ON "notifications"("profile_id", "is_read", "is_deleted");

-- CreateIndex
CREATE INDEX "notifications_profile_id_category_is_deleted_idx" ON "notifications"("profile_id", "category", "is_deleted");

-- CreateIndex
CREATE INDEX "notifications_profile_id_code_is_deleted_idx" ON "notifications"("profile_id", "code", "is_deleted");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
