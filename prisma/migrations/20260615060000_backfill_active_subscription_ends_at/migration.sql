-- An ACTIVE subscription must have an end date (paid plans are yearly with a
-- start and end). Backfill any ACTIVE row whose ends_at was left null (e.g.
-- activated outside the normal payment flow) to a full year from the later of
-- its start date or now, so the resulting date is always in the future.
UPDATE "subscriptions"
SET "ends_at" = GREATEST("starts_at", now()) + interval '1 year',
    "updated_at" = now()
WHERE "status" = 'ACTIVE'
  AND "ends_at" IS NULL
  AND "is_deleted" = false;
