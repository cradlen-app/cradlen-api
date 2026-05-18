-- DropForeignKey
ALTER TABLE "prescription_item_revisions" DROP CONSTRAINT "prescription_item_revisions_entity_fk";

-- DropForeignKey
ALTER TABLE "prescription_item_revisions" DROP CONSTRAINT "prescription_item_revisions_revised_by_fk";

-- DropForeignKey
ALTER TABLE "prescription_revisions" DROP CONSTRAINT "prescription_revisions_entity_fk";

-- DropForeignKey
ALTER TABLE "prescription_revisions" DROP CONSTRAINT "prescription_revisions_revised_by_fk";

-- DropForeignKey
ALTER TABLE "visit_encounter_revisions" DROP CONSTRAINT "visit_encounter_revisions_entity_fk";

-- DropForeignKey
ALTER TABLE "visit_encounter_revisions" DROP CONSTRAINT "visit_encounter_revisions_revised_by_fk";

-- AlterTable
ALTER TABLE "form_fields" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "form_sections" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "prescription_item_revisions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "prescription_revisions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "visit_encounter_revisions" ALTER COLUMN "id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "prescription_revisions" ADD CONSTRAINT "prescription_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_revisions" ADD CONSTRAINT "prescription_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_item_revisions" ADD CONSTRAINT "prescription_item_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "prescription_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_item_revisions" ADD CONSTRAINT "prescription_item_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_encounter_revisions" ADD CONSTRAINT "visit_encounter_revisions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "visit_encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_encounter_revisions" ADD CONSTRAINT "visit_encounter_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "notifications_user_code_deleted_idx" RENAME TO "notifications_user_id_code_is_deleted_idx";

-- RenameIndex
ALTER INDEX "prescription_item_revisions_entity_version_idx" RENAME TO "prescription_item_revisions_entity_id_version_idx";

-- RenameIndex
ALTER INDEX "prescription_revisions_entity_version_idx" RENAME TO "prescription_revisions_entity_id_version_idx";

-- RenameIndex
ALTER INDEX "visit_encounter_revisions_entity_version_idx" RENAME TO "visit_encounter_revisions_entity_id_version_idx";
