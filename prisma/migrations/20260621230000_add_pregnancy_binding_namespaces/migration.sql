-- Add the four pregnancy binding namespaces used by the obgyn_pregnancy form
-- template (journey / episode / per-visit / per-fetus scopes). Kept in its own
-- migration ahead of the table changes: Postgres forbids using a newly added
-- enum value in the same transaction that adds it. Nothing here uses the values
-- (the seed, a separate process, references them after these commit).

ALTER TYPE "BindingNamespace" ADD VALUE 'PREGNANCY_JOURNEY';
ALTER TYPE "BindingNamespace" ADD VALUE 'PREGNANCY_EPISODE';
ALTER TYPE "BindingNamespace" ADD VALUE 'PREGNANCY_VISIT';
ALTER TYPE "BindingNamespace" ADD VALUE 'PREGNANCY_FETUS';
