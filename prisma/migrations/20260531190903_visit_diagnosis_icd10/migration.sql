-- AlterEnum
ALTER TYPE "BindingNamespace" ADD VALUE 'VISIT_DIAGNOSIS';

-- CreateTable
CREATE TABLE "visit_diagnoses" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "certainty" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnosis_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chapter" TEXT,
    "specialty_code" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnosis_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_diagnoses_visit_id_is_deleted_idx" ON "visit_diagnoses"("visit_id", "is_deleted");

-- CreateIndex
CREATE INDEX "diagnosis_codes_specialty_code_idx" ON "diagnosis_codes"("specialty_code");

-- CreateIndex
CREATE UNIQUE INDEX "diagnosis_codes_code_key" ON "diagnosis_codes"("code");

-- AddForeignKey
ALTER TABLE "visit_diagnoses" ADD CONSTRAINT "visit_diagnoses_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
