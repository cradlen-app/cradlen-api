-- CreateTable
CREATE TABLE "patient_field_flags" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "section_code" TEXT NOT NULL,
    "field_code" TEXT NOT NULL,
    "note" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_field_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_field_flags_patient_id_organization_id_is_deleted_idx" ON "patient_field_flags"("patient_id", "organization_id", "is_deleted");

-- CreateIndex
CREATE INDEX "patient_field_flags_author_id_idx" ON "patient_field_flags"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_field_flags_patient_id_organization_id_section_code_key" ON "patient_field_flags"("patient_id", "organization_id", "section_code", "field_code");

-- AddForeignKey
ALTER TABLE "patient_field_flags" ADD CONSTRAINT "patient_field_flags_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_field_flags" ADD CONSTRAINT "patient_field_flags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_field_flags" ADD CONSTRAINT "patient_field_flags_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
