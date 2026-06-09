-- CreateEnum
CREATE TYPE "ServiceUnit" AS ENUM ('PER_SERVICE', 'PER_SESSION', 'PER_HOUR', 'PER_DAY', 'PER_ITEM');

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "billing_code" TEXT,
ADD COLUMN     "category_id" UUID,
ADD COLUMN     "duration_minutes" INTEGER,
ADD COLUMN     "unit" "ServiceUnit" NOT NULL DEFAULT 'PER_SERVICE';

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_categories_organization_id_is_active_is_deleted_idx" ON "service_categories"("organization_id", "is_active", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_organization_id_code_key" ON "service_categories"("organization_id", "code");

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
