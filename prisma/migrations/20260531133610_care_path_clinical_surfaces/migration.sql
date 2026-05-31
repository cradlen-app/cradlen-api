-- CreateTable
CREATE TABLE "care_path_clinical_surfaces" (
    "id" UUID NOT NULL,
    "specialty_code" TEXT NOT NULL,
    "care_path_code" TEXT NOT NULL,
    "template_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_path_clinical_surfaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "care_path_clinical_surfaces_specialty_code_care_path_code_idx" ON "care_path_clinical_surfaces"("specialty_code", "care_path_code");

-- CreateIndex
CREATE UNIQUE INDEX "care_path_clinical_surfaces_specialty_code_care_path_code_key" ON "care_path_clinical_surfaces"("specialty_code", "care_path_code");
