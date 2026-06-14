-- Knowledge-based password recovery for patient/guardian accounts (no email).
-- Nullable so existing rows (staff + pre-feature patients) are unaffected.
ALTER TABLE "users" ADD COLUMN "security_question" TEXT;
ALTER TABLE "users" ADD COLUMN "security_answer_hashed" TEXT;
