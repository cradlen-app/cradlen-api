-- CreateEnum
CREATE TYPE "FormTemplateScope" AS ENUM ('SYSTEM', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "FormTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormSurface" AS ENUM ('CLINICAL_ENCOUNTER');

-- AlterTable: add sub-specialty self-FK column
ALTER TABLE "specialties" ADD COLUMN "parent_specialty_id" UUID;

-- AlterTable: add new encounter columns (do NOT drop *_findings yet — we still need to read them)
ALTER TABLE "visit_encounters"
ADD COLUMN "ai_analysis" JSONB,
ADD COLUMN "form_template_version_id" UUID,
ADD COLUMN "responses" JSONB NOT NULL DEFAULT '{}';

-- CreateTable: form_templates
CREATE TABLE "form_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "scope" "FormTemplateScope" NOT NULL,
    "surface" "FormSurface" NOT NULL DEFAULT 'CLINICAL_ENCOUNTER',
    "specialty_id" UUID NOT NULL,
    "organization_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: form_template_versions
CREATE TABLE "form_template_versions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "FormTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "schema" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "published_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_template_versions_pkey" PRIMARY KEY ("id")
);

-- Indexes / FKs
CREATE UNIQUE INDEX "form_templates_code_key" ON "form_templates"("code");
CREATE INDEX "form_templates_organization_id_specialty_id_surface_idx" ON "form_templates"("organization_id", "specialty_id", "surface");
CREATE INDEX "form_templates_scope_specialty_id_surface_idx" ON "form_templates"("scope", "specialty_id", "surface");
CREATE INDEX "form_template_versions_template_id_status_idx" ON "form_template_versions"("template_id", "status");
CREATE UNIQUE INDEX "form_template_versions_template_id_version_number_key" ON "form_template_versions"("template_id", "version_number");
CREATE INDEX "specialties_parent_specialty_id_idx" ON "specialties"("parent_specialty_id");
CREATE INDEX "visit_encounters_form_template_version_id_idx" ON "visit_encounters"("form_template_version_id");

ALTER TABLE "specialties" ADD CONSTRAINT "specialties_parent_specialty_id_fkey" FOREIGN KEY ("parent_specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "visit_encounters" ADD CONSTRAINT "visit_encounters_form_template_version_id_fkey" FOREIGN KEY ("form_template_version_id") REFERENCES "form_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Seed the SYSTEM GYN clinical-encounter template + v1 inline so the data
-- re-pack below has a version to bind every existing encounter to. The seed
-- file also upserts this row; running it again is a no-op (unique on code).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_gyn_specialty_id UUID;
    v_template_id      UUID;
    v_version_id       UUID;
    v_schema           JSONB := '{
      "sections": [
        {
          "code": "exam_findings",
          "label": {"en": "Examination Findings"},
          "fields": [
            {"code": "general_findings",        "type": "LONG_TEXT"},
            {"code": "cardiovascular_findings", "type": "LONG_TEXT"},
            {"code": "respiratory_findings",    "type": "LONG_TEXT"},
            {"code": "menstrual_findings",      "type": "LONG_TEXT"},
            {"code": "abdominal_findings",      "type": "LONG_TEXT"},
            {"code": "pelvic_findings",         "type": "LONG_TEXT"},
            {"code": "breast_findings",         "type": "LONG_TEXT"},
            {"code": "extremities_findings",    "type": "LONG_TEXT"},
            {"code": "neurological_findings",   "type": "LONG_TEXT"},
            {"code": "skin_findings",           "type": "LONG_TEXT"}
          ]
        }
      ]
    }'::jsonb;
BEGIN
    SELECT id INTO v_gyn_specialty_id FROM "specialties" WHERE code = 'GYN' LIMIT 1;

    -- If the GYN specialty doesn't exist yet (fresh DB before seed), skip seeding
    -- the template inline — `prisma db seed` will create it after migrations run.
    IF v_gyn_specialty_id IS NOT NULL THEN
        v_template_id := gen_random_uuid();
        v_version_id  := gen_random_uuid();

        INSERT INTO "form_templates"
          (id, name, code, description, scope, surface, specialty_id, organization_id, updated_at)
        VALUES
          (v_template_id,
           'GYN Clinical Encounter (System)',
           'SYSTEM_GYN_CLINICAL_ENCOUNTER_V1',
           'Default clinical encounter template for OB/GYN, shipped by Cradlen.',
           'SYSTEM', 'CLINICAL_ENCOUNTER', v_gyn_specialty_id, NULL, NOW())
        ON CONFLICT (code) DO NOTHING
        RETURNING id INTO v_template_id;

        -- If ON CONFLICT skipped the insert, pick the existing template row
        IF v_template_id IS NULL THEN
            SELECT id INTO v_template_id FROM "form_templates"
            WHERE code = 'SYSTEM_GYN_CLINICAL_ENCOUNTER_V1' LIMIT 1;
        END IF;

        INSERT INTO "form_template_versions"
          (id, template_id, version_number, status, schema, published_at, updated_at)
        VALUES
          (v_version_id, v_template_id, 1, 'PUBLISHED', v_schema, NOW(), NOW())
        ON CONFLICT (template_id, version_number) DO NOTHING
        RETURNING id INTO v_version_id;

        IF v_version_id IS NULL THEN
            SELECT id INTO v_version_id FROM "form_template_versions"
            WHERE template_id = v_template_id AND version_number = 1 LIMIT 1;
        END IF;

        -- Re-pack each existing encounter row: stuff the 10 *_findings columns
        -- (only non-null entries) into `responses`, and bind to v1.
        UPDATE "visit_encounters" SET
            responses = (
                SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
                FROM (
                    VALUES
                        ('general_findings',        general_findings),
                        ('cardiovascular_findings', cardiovascular_findings),
                        ('respiratory_findings',    respiratory_findings),
                        ('menstrual_findings',      menstrual_findings),
                        ('abdominal_findings',      abdominal_findings),
                        ('pelvic_findings',         pelvic_findings),
                        ('breast_findings',         breast_findings),
                        ('extremities_findings',    extremities_findings),
                        ('neurological_findings',   neurological_findings),
                        ('skin_findings',           skin_findings)
                ) AS pairs(k, v)
                WHERE v IS NOT NULL
            ),
            form_template_version_id = v_version_id
        WHERE TRUE;
    END IF;
END $$;

-- Now safe to drop the legacy typed columns; data is preserved in `responses`.
ALTER TABLE "visit_encounters"
DROP COLUMN "abdominal_findings",
DROP COLUMN "breast_findings",
DROP COLUMN "cardiovascular_findings",
DROP COLUMN "extremities_findings",
DROP COLUMN "general_findings",
DROP COLUMN "menstrual_findings",
DROP COLUMN "neurological_findings",
DROP COLUMN "pelvic_findings",
DROP COLUMN "respiratory_findings",
DROP COLUMN "skin_findings";
