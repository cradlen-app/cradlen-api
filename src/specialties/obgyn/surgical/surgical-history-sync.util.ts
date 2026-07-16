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

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Activation patch — files the surgery as PLANNED with whatever the drawer
 * captured. Date preference: the actual surgery date, else the planned date;
 * keys with no value are omitted entirely (never write nulls).
 */
export function historyRowPatchForSurgicalActivation(dto: {
  procedure_code?: string;
  procedure_name?: string;
  surgery_date?: string;
  planned_date?: string;
}): HistoryGynSurgeryRowPatch {
  const patch: HistoryGynSurgeryRowPatch = { outcome: 'PLANNED' };
  if (dto.procedure_code) patch.procedure_code = dto.procedure_code;
  if (dto.procedure_name) patch.procedure_name = dto.procedure_name;
  const date = dto.surgery_date ?? dto.planned_date;
  if (date) patch.surgery_date = isoDate(new Date(date));
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
