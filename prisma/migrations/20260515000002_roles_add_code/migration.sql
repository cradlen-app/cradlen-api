-- M2 — roles_add_code
--
-- Adds a stable machine identity `code` to roles. Existing rows backfilled
-- from `name`. Internal lookups switch to `code`; `name` continues to act
-- as the human-readable display.

ALTER TABLE roles ADD COLUMN code TEXT;
UPDATE roles SET code = name;
ALTER TABLE roles ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX roles_code_key ON roles(code);
