ALTER TABLE "verification_codes"
  ADD COLUMN IF NOT EXISTS "is_resend" BOOLEAN NOT NULL DEFAULT false;
