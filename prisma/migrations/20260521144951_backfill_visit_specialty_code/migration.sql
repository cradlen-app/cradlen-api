-- Backfill specialty_code for visits that are missing it,
-- derived from the org's specialty via the branch.
-- Safe when each org has exactly one specialty (current state).
UPDATE visits v
SET specialty_code = s.code
FROM branches b
JOIN organization_specialties os ON os.organization_id = b.organization_id
JOIN specialties s ON s.id = os.specialty_id
WHERE v.branch_id = b.id
  AND v.specialty_code IS NULL;