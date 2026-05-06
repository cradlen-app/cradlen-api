-- Restructure VisitType: collapse INITIAL/ROUTINE/EMERGENCY/PROCEDURE → VISIT, add MEDICAL_REP
-- PostgreSQL does not support DROP VALUE on enums, so we recreate the type.

CREATE TYPE "VisitType_new" AS ENUM ('VISIT', 'FOLLOW_UP', 'MEDICAL_REP');

ALTER TABLE "visits"
  ALTER COLUMN "visit_type" TYPE "VisitType_new"
  USING (
    CASE "visit_type"::text
      WHEN 'FOLLOW_UP' THEN 'FOLLOW_UP'::"VisitType_new"
      ELSE 'VISIT'::"VisitType_new"
    END
  );

DROP TYPE "VisitType";
ALTER TYPE "VisitType_new" RENAME TO "VisitType";
