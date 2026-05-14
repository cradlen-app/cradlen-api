-- AlterTable
ALTER TABLE "medical_rep_visits" ADD COLUMN     "form_template_id" UUID;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "form_template_id" UUID;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_rep_visits" ADD CONSTRAINT "medical_rep_visits_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
