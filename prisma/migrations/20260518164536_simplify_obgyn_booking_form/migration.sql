-- CreateTable
CREATE TABLE "chief_complaint_categories" (
    "id" UUID NOT NULL,
    "specialty_code" TEXT NOT NULL,
    "care_path_code" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chief_complaint_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chief_complaint_categories_specialty_code_care_path_code_idx" ON "chief_complaint_categories"("specialty_code", "care_path_code");

-- CreateIndex
CREATE UNIQUE INDEX "chief_complaint_categories_specialty_code_care_path_code_co_key" ON "chief_complaint_categories"("specialty_code", "care_path_code", "code");

-- Enable pg_trgm for fast ILIKE search on medical_rep.company_name
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "medical_rep_company_name_trgm_idx" ON "medical_reps" USING gin ("company_name" gin_trgm_ops);
