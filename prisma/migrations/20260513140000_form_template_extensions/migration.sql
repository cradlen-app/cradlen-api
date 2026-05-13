-- AlterTable
ALTER TABLE "form_templates" ADD COLUMN     "extension_key" TEXT,
ADD COLUMN     "parent_template_id" UUID;

-- CreateIndex
CREATE INDEX "form_templates_parent_template_id_extension_key_idx" ON "form_templates"("parent_template_id", "extension_key");

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_parent_template_id_fkey" FOREIGN KEY ("parent_template_id") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Replace the old "active shell" partial unique with one scoped to parent_template_id IS NULL.
-- The pre-composition index allowed exactly one active row per code; with composition, that
-- invariant applies only to shells (extensions are uniquely identified by parent+key, not code).
DROP INDEX IF EXISTS "form_templates_code_active_unique";
CREATE UNIQUE INDEX "form_templates_code_active_shell_unique"
  ON "form_templates" ("code")
  WHERE "is_active" = TRUE AND "is_deleted" = FALSE AND "parent_template_id" IS NULL;

-- One active extension per (parent, extension_key).
CREATE UNIQUE INDEX "form_templates_parent_ext_active_unique"
  ON "form_templates" ("parent_template_id", "extension_key")
  WHERE "is_active" = TRUE AND "is_deleted" = FALSE AND "parent_template_id" IS NOT NULL;

-- Symmetry: extension rows must declare an extension_key; shell rows must not.
ALTER TABLE "form_templates"
  ADD CONSTRAINT "form_templates_extension_symmetry_check"
  CHECK (("parent_template_id" IS NULL) = ("extension_key" IS NULL));
