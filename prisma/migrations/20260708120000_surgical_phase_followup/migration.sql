-- Surgical vertical: the operative note moves off the per-visit record onto the
-- Surgery phase-episode record (SurgicalEpisodeRecord.operative_summary), which
-- is singular per journey and visible from any visit. `visit_surgical_records`
-- is repurposed for the per-encounter post-op follow-up (interval history, wound
-- assessment this visit, plan). The old operative columns are now dead — the
-- table was empty at migration time, so no data is lost.

-- AlterTable
ALTER TABLE "visit_surgical_records" DROP COLUMN "additional_findings",
DROP COLUMN "complications",
DROP COLUMN "drains",
DROP COLUMN "duration_minutes",
DROP COLUMN "estimated_blood_loss_ml",
DROP COLUMN "findings",
DROP COLUMN "procedure_performed",
ADD COLUMN     "interval_history" TEXT,
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "wound_assessment" TEXT;
