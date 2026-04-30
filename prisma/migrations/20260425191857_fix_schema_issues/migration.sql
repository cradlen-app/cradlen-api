-- DropIndex
DROP INDEX IF EXISTS "email_verifications_user_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "password_resets_user_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "refresh_tokens_user_id_idx";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;
