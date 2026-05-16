-- F1 — care_path_to_journey_template
--
-- Each care path resolves 1:1 to a JourneyTemplate at booking time. The
-- mapping was previously hardcoded in visits.service to GENERAL_GYN, which
-- silently anchored pregnancy bookings to the wrong template.

BEGIN;

ALTER TABLE care_paths ADD COLUMN journey_template_id UUID;

-- Backfill: map each seeded care_path code to its journey_templates code
-- (journey_templates.code was added in M6 — values mirror the
-- JourneyTemplateType enum: PREGNANCY / GENERAL_GYN / SURGICAL /
-- CHRONIC_CONDITION).
UPDATE care_paths cp
   SET journey_template_id = jt.id
  FROM journey_templates jt
 WHERE jt.specialty_id = cp.specialty_id
   AND jt.code = CASE cp.code
       WHEN 'OBGYN_GENERAL'     THEN 'GENERAL_GYN'
       WHEN 'OBGYN_PREGNANCY'   THEN 'PREGNANCY'
       WHEN 'OBGYN_SURGICAL'    THEN 'SURGICAL'
       WHEN 'OBGYN_INFERTILITY' THEN 'CHRONIC_CONDITION'
       ELSE NULL
   END;

-- Any care_path rows the mapping above didn't cover (custom org-level paths)
-- fall back to the specialty's GENERAL_GYN template so the NOT NULL pass
-- succeeds. Operators should re-target these intentionally afterwards.
UPDATE care_paths cp
   SET journey_template_id = jt.id
  FROM journey_templates jt
 WHERE cp.journey_template_id IS NULL
   AND jt.specialty_id = cp.specialty_id
   AND jt.code = 'GENERAL_GYN';

ALTER TABLE care_paths ALTER COLUMN journey_template_id SET NOT NULL;

ALTER TABLE care_paths ADD CONSTRAINT care_paths_journey_template_id_fkey
    FOREIGN KEY (journey_template_id) REFERENCES journey_templates(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX care_paths_journey_template_id_idx
    ON care_paths(journey_template_id);

COMMIT;
