/*
  Warnings:

  - The `status` column on the `refunds` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'VOID');

-- AlterTable
ALTER TABLE "price_list_items" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "price_lists" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "provider_price_overrides" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "provider_services" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "refunds" DROP COLUMN "status",
ADD COLUMN     "status" "RefundStatus" NOT NULL DEFAULT 'COMPLETED';

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_price_overrides" ADD CONSTRAINT "provider_price_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
