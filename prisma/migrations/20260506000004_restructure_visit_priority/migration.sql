-- Restructure VisitPriority: collapse LOW/NORMAL/HIGH → NORMAL, URGENT → EMERGENCY
-- PostgreSQL does not support DROP VALUE on enums, so we recreate the type.

CREATE TYPE "VisitPriority_new" AS ENUM ('NORMAL', 'EMERGENCY');

ALTER TABLE "visits"
  ALTER COLUMN "priority" TYPE "VisitPriority_new"
  USING (
    CASE "priority"::text
      WHEN 'URGENT' THEN 'EMERGENCY'::"VisitPriority_new"
      ELSE 'NORMAL'::"VisitPriority_new"
    END
  );

DROP TYPE "VisitPriority";
ALTER TYPE "VisitPriority_new" RENAME TO "VisitPriority";
