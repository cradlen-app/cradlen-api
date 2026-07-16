import { SurgicalOutcomeDto } from './dto/surgical-activation.dto';

/**
 * Maps the surgical journey lifecycle onto the patient-history `gyn_surgeries`
 * row that the sync files (see `ObgynHistoryService.upsertJourneyGynSurgeryRow`).
 * Pure and deterministic — no Prisma, no clock reads (the caller passes `now`).
 *
 * Unlike the pregnancy close there is no vocabulary bridge: the close
 * `outcome_type` values (COMPLETED/ABORTED/CONVERTED/TRANSFERRED/DECEASED/
 * OTHER) are stored 1:1 as the row outcome; activation files PLANNED.
 */

export interface HistoryGynSurgeryRowPatch {
  outcome: string;
  procedure_code?: string;
  procedure_name?: string;
  surgery_date?: string;
  complications?: string;
  notes?: string;
}

/** Procedure/date fields as carried by `SurgicalJourneyRecord`. */
export interface SurgicalRecordFields {
  procedure_code: string | null;
  procedure_name: string | null;
  surgery_date: Date | null;
  planned_date: Date | null;
}

function isoDate(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Activation/still-planned patch — files (or refreshes) the surgery as PLANNED
 * with whatever is known so far. Accepts either the activation DTO (string
 * dates) or the `SurgicalJourneyRecord` row (Date columns) — the clinical
 * surface PATCH re-syncs the history row from the updated record on every
 * Journey-section save while the record is ACTIVE. Date preference: the actual
 * surgery date, else the planned date; keys with no value are omitted entirely
 * (never write nulls).
 */
export function historyRowPatchForSurgicalActivation(source: {
  procedure_code?: string | null;
  procedure_name?: string | null;
  surgery_date?: string | Date | null;
  planned_date?: string | Date | null;
}): HistoryGynSurgeryRowPatch {
  const patch: HistoryGynSurgeryRowPatch = { outcome: 'PLANNED' };
  if (source.procedure_code) patch.procedure_code = source.procedure_code;
  if (source.procedure_name) patch.procedure_name = source.procedure_name;
  const date = source.surgery_date ?? source.planned_date;
  if (date) patch.surgery_date = isoDate(date);
  return patch;
}

/**
 * Close patch — finalizes the row's outcome. Date preference: the record's
 * surgery date, else the outcome date, else `now`. Procedure fields are
 * carried so the append-at-close fallback (a pre-feature journey with no
 * tagged row) still files a complete row.
 */
export function historyRowPatchForSurgicalClose(
  outcome: SurgicalOutcomeDto,
  record: SurgicalRecordFields,
  now: Date,
): HistoryGynSurgeryRowPatch {
  const date =
    record.surgery_date ?? (outcome.date ? new Date(outcome.date) : now);

  const patch: HistoryGynSurgeryRowPatch = {
    outcome: outcome.outcome_type,
    surgery_date: isoDate(date),
  };
  if (record.procedure_code) patch.procedure_code = record.procedure_code;
  if (record.procedure_name) patch.procedure_name = record.procedure_name;
  if (outcome.complications?.length) {
    patch.complications = outcome.complications.join(', ');
  }
  if (outcome.notes) patch.notes = outcome.notes;
  return patch;
}
