-- Move patient/guardian portal logins out of the shared `users` table into a
-- dedicated `patient_accounts` table. Staff identities stay in `users`.
--
-- ORDER MATTERS: `refresh_tokens.user_id` has ON DELETE CASCADE, so we must
-- repoint patient refresh tokens to their new account BEFORE deleting the
-- migrated user rows, otherwise those tokens would be cascade-deleted.
-- Each migrated account REUSES the old user UUID as its id, so in-flight patient
-- JWTs (whose `userId` claim == old user id) keep resolving against the new row.

-- 1. New table + uniqueness ---------------------------------------------------
CREATE TABLE "patient_accounts" (
    "id" UUID NOT NULL,
    "password_hashed" TEXT,
    "security_question" TEXT,
    "security_answer_hashed" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "patient_id" UUID,
    "guardian_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_accounts_patient_id_key" ON "patient_accounts"("patient_id");
CREATE UNIQUE INDEX "patient_accounts_guardian_id_key" ON "patient_accounts"("guardian_id");

ALTER TABLE "patient_accounts" ADD CONSTRAINT "patient_accounts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "patient_accounts" ADD CONSTRAINT "patient_accounts_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. refresh_tokens gains a patient-account owner; user_id becomes optional ----
ALTER TABLE "refresh_tokens" ADD COLUMN "patient_account_id" UUID;
ALTER TABLE "refresh_tokens" ALTER COLUMN "user_id" DROP NOT NULL;
CREATE INDEX "refresh_tokens_patient_account_id_is_revoked_idx" ON "refresh_tokens"("patient_account_id", "is_revoked");
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_patient_account_id_fkey" FOREIGN KEY ("patient_account_id") REFERENCES "patient_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Backfill: every patient/guardian-linked user becomes a patient_account ----
--    (reuse the same UUID so existing tokens/JWTs keep resolving).
INSERT INTO "patient_accounts" (
    "id", "password_hashed", "security_question", "security_answer_hashed",
    "is_active", "is_deleted", "deleted_at", "patient_id", "guardian_id",
    "created_at", "updated_at"
)
SELECT
    "id", "password_hashed", "security_question", "security_answer_hashed",
    "is_active", "is_deleted", "deleted_at", "patient_id", "guardian_id",
    "created_at", "updated_at"
FROM "users"
WHERE "patient_id" IS NOT NULL OR "guardian_id" IS NOT NULL;

-- 4. Repoint their refresh tokens to the new account (before deleting users) ---
UPDATE "refresh_tokens"
SET "patient_account_id" = "user_id", "user_id" = NULL
WHERE "user_id" IN (SELECT "id" FROM "patient_accounts");

-- 5. Delete the migrated user rows (their auth_audit_log rows null out via the
--    existing ON DELETE SET NULL; their refresh tokens are already repointed) --
DELETE FROM "users"
WHERE "id" IN (SELECT "id" FROM "patient_accounts");

-- 6. Drop the now-unused patient-facing columns from `users` -------------------
ALTER TABLE "users" DROP CONSTRAINT "users_guardian_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_patient_id_fkey";
DROP INDEX "users_guardian_id_key";
DROP INDEX "users_patient_id_key";
ALTER TABLE "users"
    DROP COLUMN "guardian_id",
    DROP COLUMN "patient_id",
    DROP COLUMN "security_answer_hashed",
    DROP COLUMN "security_question";

-- 7. A refresh token has exactly one owner: a staff user OR a patient account --
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_exactly_one_owner"
    CHECK (("user_id" IS NOT NULL) <> ("patient_account_id" IS NOT NULL));
