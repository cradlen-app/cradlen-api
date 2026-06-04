-- AlterTable
ALTER TABLE "guardians" ADD COLUMN     "date_of_birth" DATE;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "guardian_id" UUID,
ADD COLUMN     "patient_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "users_patient_id_key" ON "users"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_guardian_id_key" ON "users"("guardian_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;
