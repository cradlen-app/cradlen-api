-- Backfills the `professional_title` column that exists in schema.prisma
-- (Profile + Invitation) but was never captured in a committed migration —
-- so a database built purely from `prisma/migrations` was missing it, and
-- `POST /auth/signup/complete` 500'd with P2022 (column does not exist) on a
-- fresh deploy / DR restore. Idempotent ADD so re-applying over an
-- out-of-band-patched dev/prod DB is a no-op.

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "professional_title" TEXT;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "professional_title" TEXT;
