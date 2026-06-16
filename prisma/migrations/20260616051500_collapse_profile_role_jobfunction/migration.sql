-- Collapse Profile/Invitation `role` and `job_function` from many-to-many join
-- tables into single FK columns. `role_id` is mandatory (every profile/invitation
-- has exactly one role); `job_function_id` is nullable (owners/admins may have none).
-- `specialty` and `branch` remain many-to-many and are untouched.
--
-- PREREQUISITE — run the catalog-collapse data step FIRST (tmp-migrate-job-functions.cjs),
-- which dedupes the join tables to <= 1 role and <= 1 job function per row. Verify
-- (each query must return ZERO rows) before applying this migration:
--   SELECT profile_id    FROM profile_roles          GROUP BY 1 HAVING count(*) > 1;
--   SELECT profile_id    FROM profile_job_functions  GROUP BY 1 HAVING count(*) > 1;
--   SELECT invitation_id FROM invitation_roles       GROUP BY 1 HAVING count(*) > 1;
--   SELECT invitation_id FROM invitation_job_functions GROUP BY 1 HAVING count(*) > 1;

-- 1. Add the new columns (nullable for the backfill).
ALTER TABLE "profiles"    ADD COLUMN "role_id" UUID;
ALTER TABLE "profiles"    ADD COLUMN "job_function_id" UUID;
ALTER TABLE "invitations" ADD COLUMN "role_id" UUID;
ALTER TABLE "invitations" ADD COLUMN "job_function_id" UUID;

-- 2. Backfill from the join tables (earliest link by created_at wins).
UPDATE "profiles" p SET "role_id" = (
  SELECT pr."role_id" FROM "profile_roles" pr
  WHERE pr."profile_id" = p."id" ORDER BY pr."created_at" ASC LIMIT 1
);
UPDATE "profiles" p SET "job_function_id" = (
  SELECT pjf."job_function_id" FROM "profile_job_functions" pjf
  WHERE pjf."profile_id" = p."id" ORDER BY pjf."created_at" ASC LIMIT 1
);
UPDATE "invitations" i SET "role_id" = (
  SELECT ir."role_id" FROM "invitation_roles" ir
  WHERE ir."invitation_id" = i."id" ORDER BY ir."created_at" ASC LIMIT 1
);
UPDATE "invitations" i SET "job_function_id" = (
  SELECT ijf."job_function_id" FROM "invitation_job_functions" ijf
  WHERE ijf."invitation_id" = i."id" ORDER BY ijf."created_at" ASC LIMIT 1
);

-- 3. role_id is mandatory; job_function_id stays nullable.
ALTER TABLE "profiles"    ALTER COLUMN "role_id" SET NOT NULL;
ALTER TABLE "invitations" ALTER COLUMN "role_id" SET NOT NULL;

-- 4. Foreign keys (Prisma defaults: required = RESTRICT, optional = SET NULL).
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_job_function_id_fkey"
  FOREIGN KEY ("job_function_id") REFERENCES "job_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_job_function_id_fkey"
  FOREIGN KEY ("job_function_id") REFERENCES "job_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Indexes (Profile only — Invitation declares none).
CREATE INDEX "profiles_role_id_idx" ON "profiles"("role_id");
CREATE INDEX "profiles_job_function_id_idx" ON "profiles"("job_function_id");

-- 6. Drop the now-redundant join tables.
DROP TABLE "profile_roles";
DROP TABLE "profile_job_functions";
DROP TABLE "invitation_roles";
DROP TABLE "invitation_job_functions";
