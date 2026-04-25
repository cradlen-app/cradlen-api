-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'ACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: add column defaulting to ACTIVE so existing rows are not regressed (idempotent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "registration_status" "RegistrationStatus" NOT NULL DEFAULT 'ACTIVE';

-- Update default to PENDING for all new registrations going forward
ALTER TABLE "users" ALTER COLUMN "registration_status" SET DEFAULT 'PENDING';

-- AddForeignKey: Profile cascade delete (drop and re-add idempotently)
ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_user_id_fkey";
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: EmailVerification cascade delete (idempotent — table may not exist)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_verifications') THEN
    ALTER TABLE "email_verifications" DROP CONSTRAINT IF EXISTS "email_verifications_user_id_fkey";
    ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: PasswordReset cascade delete (idempotent)
ALTER TABLE "password_resets" DROP CONSTRAINT IF EXISTS "password_resets_user_id_fkey";
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
