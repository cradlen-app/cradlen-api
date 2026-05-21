-- Backfill organization_specialties from profile_specialties.
-- Covers orgs created before the specialty-linking requirement was enforced,
-- where profile-level specialties were set but org-level links were skipped.
-- Safe to re-run: WHERE NOT EXISTS skips already-present rows.
INSERT INTO organization_specialties (id, organization_id, specialty_id, created_at)
SELECT
  gen_random_uuid(),
  p.organization_id,
  ps.specialty_id,
  NOW()
FROM profile_specialties ps
JOIN profiles p ON p.id = ps.profile_id AND p.is_deleted = FALSE
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_specialties os
  WHERE os.organization_id = p.organization_id
    AND os.specialty_id    = ps.specialty_id
);
