-- Pregnancy "labs" (anomaly scan, GTT, trimester summary) move from the
-- per-trimester episode record to the journey record, so they are one-per-
-- pregnancy and pre-fill on every visit (like the rest of the journey section).
-- The now-empty PregnancyEpisodeRecord (+ its revision shadow) is dropped.
-- Trimester visit routing is unaffected (it only re-points visit.episode_id).

-- 1. New journey-scoped columns.
ALTER TABLE "pregnancy_journey_records"
  ADD COLUMN "anomaly_scan" JSONB,
  ADD COLUMN "gtt_result" JSONB,
  ADD COLUMN "trimester_summary" JSONB;

-- 2. Backfill: for each journey, carry over the most-recently-updated episode
--    record that actually holds any lab data.
UPDATE "pregnancy_journey_records" pjr
SET
  "anomaly_scan" = src."anomaly_scan",
  "gtt_result" = src."gtt_result",
  "trimester_summary" = src."trimester_summary"
FROM (
  SELECT DISTINCT ON (pe."journey_id")
    pe."journey_id" AS journey_id,
    per."anomaly_scan" AS "anomaly_scan",
    per."gtt_result" AS "gtt_result",
    per."trimester_summary" AS "trimester_summary"
  FROM "pregnancy_episode_records" per
  JOIN "patient_episodes" pe ON pe."id" = per."episode_id"
  WHERE per."is_deleted" = false
    AND (
      per."anomaly_scan" IS NOT NULL
      OR per."gtt_result" IS NOT NULL
      OR per."trimester_summary" IS NOT NULL
    )
  ORDER BY pe."journey_id", per."updated_at" DESC
) src
WHERE pjr."journey_id" = src.journey_id;

-- 3. Drop the retired per-episode record + its revision shadow (revision FKs the
--    record, so drop it first).
DROP TABLE "pregnancy_episode_record_revisions";
DROP TABLE "pregnancy_episode_records";
