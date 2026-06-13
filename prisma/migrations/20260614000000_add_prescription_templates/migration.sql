-- CreateTable
CREATE TABLE "prescription_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "branch_id" UUID,
    "profile_id" UUID,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescription_templates_organization_id_idx" ON "prescription_templates"("organization_id");

-- CreateIndex
CREATE INDEX "prescription_templates_branch_id_idx" ON "prescription_templates"("branch_id");

-- CreateIndex
CREATE INDEX "prescription_templates_profile_id_idx" ON "prescription_templates"("profile_id");
