-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "episode_id" UUID;

-- CreateIndex
CREATE INDEX "invoices_episode_id_is_deleted_idx" ON "invoices"("episode_id", "is_deleted");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "patient_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
