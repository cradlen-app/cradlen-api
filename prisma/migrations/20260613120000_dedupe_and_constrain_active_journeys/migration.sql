-- ============================================================
-- Dedupe duplicate ACTIVE patient journeys, then enforce at most
-- one active journey per (patient, journey_template).
--
-- Root cause: a non-deterministic care-path lookup let a single
-- care path resolve to different care_path_ids, and the active-
-- journey lookup keyed on care_path_id, so a divergent id spawned
-- a second ACTIVE journey of the same template. We merge existing
-- duplicates (keep oldest) and add a partial unique index guard.
--
-- Each statement is self-contained (CTEs, not temp tables) so it is
-- robust whether or not the runner shares one transaction. The
-- survivor/loser set is recomputed from active journeys per
-- statement; journeys are retired LAST so the earlier statements
-- still see the losers as active.
-- ============================================================

-- 1. Re-parent loser visits onto the survivor's episode sharing the same
--    episode_template_id (both journeys derive from one template). Survivor =
--    earliest started_at (tie-break created_at, then id) per (patient, template).
WITH ranked AS (
  SELECT
    id,
    patient_id,
    journey_template_id,
    ROW_NUMBER() OVER (
      PARTITION BY patient_id, journey_template_id
      ORDER BY started_at ASC, created_at ASC, id ASC
    ) AS rn
  FROM patient_journeys
  WHERE status = 'ACTIVE' AND is_deleted = false
),
survivors AS (
  SELECT patient_id, journey_template_id, id AS survivor_id FROM ranked WHERE rn = 1
),
losers AS (
  SELECT r.id AS loser_id, s.survivor_id
  FROM ranked r
  JOIN survivors s
    ON s.patient_id = r.patient_id
   AND s.journey_template_id = r.journey_template_id
  WHERE r.rn > 1
)
UPDATE visits v
SET episode_id = se.id
FROM patient_episodes le
JOIN losers l ON le.journey_id = l.loser_id
JOIN patient_episodes se
  ON se.journey_id = l.survivor_id
 AND se.episode_template_id = le.episode_template_id
WHERE v.episode_id = le.id;

-- 2. Soft-delete the losers' episodes.
WITH ranked AS (
  SELECT
    id,
    patient_id,
    journey_template_id,
    ROW_NUMBER() OVER (
      PARTITION BY patient_id, journey_template_id
      ORDER BY started_at ASC, created_at ASC, id ASC
    ) AS rn
  FROM patient_journeys
  WHERE status = 'ACTIVE' AND is_deleted = false
),
losers AS (
  SELECT id AS loser_id FROM ranked WHERE rn > 1
)
UPDATE patient_episodes e
SET is_deleted = true, deleted_at = now()
FROM losers l
WHERE e.journey_id = l.loser_id AND e.is_deleted = false;

-- 3. Retire the loser journeys (runs last so steps 1-2 still saw them active).
WITH ranked AS (
  SELECT
    id,
    patient_id,
    journey_template_id,
    ROW_NUMBER() OVER (
      PARTITION BY patient_id, journey_template_id
      ORDER BY started_at ASC, created_at ASC, id ASC
    ) AS rn
  FROM patient_journeys
  WHERE status = 'ACTIVE' AND is_deleted = false
),
losers AS (
  SELECT id AS loser_id FROM ranked WHERE rn > 1
)
UPDATE patient_journeys j
SET status = 'CANCELLED', ended_at = now(), is_deleted = true, deleted_at = now()
FROM losers l
WHERE j.id = l.loser_id;

-- NOTE: visits + episodes are merged onto the survivor; pregnancy journey/episode
-- records on losers are NOT re-parented (out of scope — GYN-general dedupe).

-- 4. Enforce going forward: one ACTIVE journey per (patient, template).
--    Partial unique index — cannot be expressed in the Prisma schema, raw SQL only.
CREATE UNIQUE INDEX "patient_journeys_one_active_per_template"
  ON "patient_journeys"("patient_id", "journey_template_id")
  WHERE status = 'ACTIVE' AND is_deleted = false;
