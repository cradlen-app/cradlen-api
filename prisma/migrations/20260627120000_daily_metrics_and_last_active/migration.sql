-- AlterTable
ALTER TABLE "patient_accounts" ADD COLUMN     "last_active_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_active_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "daily_metric_snapshots" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "active_staff" INTEGER NOT NULL,
    "total_staff" INTEGER NOT NULL,
    "active_portals" INTEGER NOT NULL,
    "total_portals" INTEGER NOT NULL,
    "total_enrolled_patients" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_metric_snapshots_date_key" ON "daily_metric_snapshots"("date");

-- CreateIndex
CREATE INDEX "patient_accounts_last_active_at_idx" ON "patient_accounts"("last_active_at");

-- CreateIndex
CREATE INDEX "users_last_active_at_idx" ON "users"("last_active_at");
