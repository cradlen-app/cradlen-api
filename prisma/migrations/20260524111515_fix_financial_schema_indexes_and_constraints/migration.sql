/*
  Warnings:

  - You are about to drop the column `duration` on the `provider_services` table. All the data in the column will be lost.
  - Added the required column `updated_at` to the `refunds` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "invoice_insurance_claims" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "provider_services" DROP COLUMN "duration",
ADD COLUMN     "duration_minutes" INTEGER;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_is_deleted_idx" ON "payments"("invoice_id", "is_deleted");
