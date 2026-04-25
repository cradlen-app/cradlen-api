-- DropIndex
DROP INDEX "email_verifications_user_id_idx";

-- DropIndex
DROP INDEX "password_resets_user_id_idx";

-- DropIndex
DROP INDEX "refresh_tokens_user_id_idx";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;
