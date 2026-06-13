-- ============================================================
-- Dedupe duplicate ACTIVE patient journeys, then enforce at most
-- one active journey per (patient, journey_template).
--
-- Root cause: a non-deterministic care-path lookup let a single
-- care path resolve to different care_path_ids, and the active-
-- journey lookup keyed on care_path_id, so a divergent id spawned
-- a second ACTIVE journey of the same template. We merge existing
-- duplicates (keep oldest) and add a partial unique index guard.
-- ============================================================

-- 1. Rank active, non-deleted journeys within each (patient, template).
--    Survivor = earliest started_at (tie-break created_at, then id).
CREATE TEMP TABLE _journey_dedupe ON COMMIT DROP AS
SELECT
  id,
  patient_id,
  journey_template_id,
  ROW_NUMBER() OVER (
    PARTITION BY patient_id, journey_template_id
    ORDER BY started_at ASC, created_at ASC, id ASC
  ) AS rn
FROM patient_journeys
WHERE status = 'ACTIVE' AND is_deleted = false;

-- Survivor per group, joinable by (patient, template).
CREATE TEMP TABLE _journey_survivors ON COMMIT DROP AS
SELECT patient_id, journey_template_id, id AS survivor_id
FROM _journey_dedupe
WHERE rn = 1;

-- Loser journeys (every duplicate beyond the survivor), with their survivor.
CREATE TEMP TABLE _journey_losers ON COMMIT DROP AS
SELECT d.id AS loser_id, s.survivor_id
FROM _journey_dedupe d
JOIN _journey_survivors s
  ON s.patient_id = d.patient_id
 AND s.journey_template_id = d.journey_template_id
WHERE d.rn > 1;

-- 2. Re-parent loser visits onto the survivor's episode sharing the same
--    episode_template_id (both journeys derive from one template).
UPDATE visits v
SET episode_id = se.id
FROM patient_episodes le
JOIN _journey_losers l ON le.journey_id = l.loser_id
JOIN patient_episodes se
  ON se.journey_id = l.survivor_id
 AND se.episode_template_id = le.episode_template_id
WHERE v.episode_id = le.id;

-- 3. Soft-delete the losers' episodes.
UPDATE patient_episodes e
SET is_deleted = true, deleted_at = now()
FROM _journey_losers l
WHERE e.journey_id = l.loser_id AND e.is_deleted = false;

-- 4. Retire the loser journeys.
UPDATE patient_journeys j
SET status = 'CANCELLED', ended_at = now(), is_deleted = true, deleted_at = now()
FROM _journey_losers l
WHERE j.id = l.loser_id;

-- NOTE: visits + episodes are merged onto the survivor; pregnancy journey/episode
-- records on losers are NOT re-parented (out of scope — GYN-general dedupe).

-- 5. Enforce going forward: one ACTIVE journey per (patient, template).
--    Partial unique index — cannot be expressed in the Prisma schema, raw SQL only.
CREATE UNIQUE INDEX "patient_journeys_one_active_per_template"
  ON "patient_journeys"("patient_id", "journey_template_id")
  WHERE status = 'ACTIVE' AND is_deleted = false;
