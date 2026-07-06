-- Move Patient.national_id uniqueness to the blind index (national_id_bidx).
-- national_id becomes ciphertext (encrypted at the Prisma client layer); the
-- blind index carries uniqueness + exact lookup. Backfill populates existing
-- rows immediately after — see scripts/backfill-national-id.cjs and
-- docs/security/field-encryption-rollout.md.

-- DropIndex
DROP INDEX "patients_national_id_key";

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "national_id_bidx" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "patients_national_id_bidx_key" ON "patients"("national_id_bidx");
