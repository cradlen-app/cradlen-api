-- branch_single_main_per_org
--
-- At most one main branch per organization on live rows. The service layer
-- already enforces this (demote-others-then-set-one inside a transaction); the
-- partial unique is belt-and-braces so any other write path that violates the
-- invariant fails loud at the DB. Mirrors
-- patient_guardians_one_primary_per_relation_unique.

-- Demote any pre-existing duplicate mains before adding the constraint. For
-- each organization we keep the most recently updated live main and unset
-- is_main on the rest.
UPDATE branches b
   SET is_main = false
  FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY organization_id
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
      FROM branches
     WHERE is_main = true AND is_deleted = false
  ) AS ranked
 WHERE ranked.id = b.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX branches_one_main_per_org_live_unique
    ON branches(organization_id)
    WHERE is_main = true AND is_deleted = false;
