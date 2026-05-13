-- AlterEnum
ALTER TYPE "MedicalRepVisitStatus" ADD VALUE 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "medical_rep_visits" ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "started_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "medical_rep_visits_branch_id_status_scheduled_at_idx" ON "medical_rep_visits"("branch_id", "status", "scheduled_at");
