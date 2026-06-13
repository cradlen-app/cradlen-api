-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_episode_id_fkey";

-- DropIndex
DROP INDEX "invoices_episode_id_is_deleted_idx";

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "episode_id";

-- CreateIndex
CREATE INDEX "invoices_visit_id_is_deleted_idx" ON "invoices"("visit_id", "is_deleted");
