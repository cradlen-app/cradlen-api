-- DropIndex
DROP INDEX IF EXISTS "email_verifications_user_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "password_resets_user_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "refresh_tokens_user_id_idx";

-- AlterTable (conditional: column may not exist yet in this migration order)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'updated_at') THEN
    ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;
END $$;
