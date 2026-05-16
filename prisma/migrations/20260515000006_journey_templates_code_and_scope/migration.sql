-- M6 — journey_templates_code_and_scope
--
-- - JourneyTemplate gets a stable machine `code`; scope its uniqueness to
--   specialty so two specialties can use the same name.
-- - EpisodeTemplate gets @@unique([journey_template_id, order]) to prevent
--   duplicate ordering inside a template.

BEGIN;

ALTER TABLE journey_templates ADD COLUMN code TEXT;
UPDATE journey_templates SET code = type::TEXT;
ALTER TABLE journey_templates ALTER COLUMN code SET NOT NULL;

DROP INDEX IF EXISTS journey_templates_name_key;
ALTER TABLE journey_templates DROP CONSTRAINT IF EXISTS journey_templates_name_key;

CREATE UNIQUE INDEX journey_templates_specialty_id_code_key
    ON journey_templates(specialty_id, code);
CREATE UNIQUE INDEX journey_templates_specialty_id_name_key
    ON journey_templates(specialty_id, name);

CREATE UNIQUE INDEX episode_templates_journey_template_id_order_key
    ON episode_templates(journey_template_id, "order");

COMMIT;
