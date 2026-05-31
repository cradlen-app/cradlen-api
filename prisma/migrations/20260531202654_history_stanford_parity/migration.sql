-- AlterTable
ALTER TABLE "patient_obgyn_histories" ADD COLUMN     "gynecologic_conditions" JSONB,
ADD COLUMN     "sexual_history" JSONB;

-- AlterTable
ALTER TABLE "patient_pregnancy_history" ADD COLUMN     "baby_sex" TEXT,
ADD COLUMN     "baby_weight" TEXT;

-- CreateTable
CREATE TABLE "patient_family_history" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "condition" TEXT NOT NULL,
    "relative" TEXT,
    "age_of_diagnosis" INTEGER,
    "notes" TEXT,
    "created_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_family_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_family_history_patient_id_is_deleted_idx" ON "patient_family_history"("patient_id", "is_deleted");

-- AddForeignKey
ALTER TABLE "patient_family_history" ADD CONSTRAINT "patient_family_history_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
