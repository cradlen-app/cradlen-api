-- CreateTable
CREATE TABLE "care_path_history_sections" (
    "id" UUID NOT NULL,
    "specialty_code" TEXT NOT NULL,
    "care_path_code" TEXT NOT NULL,
    "section_code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_path_history_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "care_path_history_sections_specialty_code_care_path_code_idx" ON "care_path_history_sections"("specialty_code", "care_path_code");

-- CreateIndex
CREATE UNIQUE INDEX "care_path_history_sections_specialty_code_care_path_code_se_key" ON "care_path_history_sections"("specialty_code", "care_path_code", "section_code");
