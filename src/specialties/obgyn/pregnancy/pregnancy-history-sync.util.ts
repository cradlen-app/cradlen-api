import { gaFromLmp, gaFromUsDating } from './ga.util';
import { PregnancyOutcomeDto } from './dto/pregnancy-activation.dto';

/**
 * Maps a pregnancy-close outcome onto the patient-history pregnancy row that
 * the GTPAL sync finalizes (see `ObgynHistoryService.upsertJourneyPregnancyRow`).
 * Pure and deterministic — no Prisma, no clock reads (the caller passes `now`).
 *
 * Vocabulary bridges between the close DTO and the history row:
 *   - outcome_type TERMINATION → row outcome ABORTION (the history taxonomy);
 *     TRANSFERRED / LOST_TO_FOLLOWUP / OTHER → OTHER (counts gravida only).
 *   - delivery_mode ASSISTED → mode_of_delivery ASSISTED_VAGINAL.
 *
 * GA at close follows the surface's US-dating-wins rule (same as
 * `PregnancyEpisodeRouterService`); when no usable dating exists the field is
 * omitted entirely — never a false 0, so an unknown-GA stillbirth correctly
 * does not count toward para.
 */

/** Dating fields as carried by `PregnancyJourneyRecord`. */
export interface PregnancyDatingFields {
  lmp: Date | null;
  us_dating_date: Date | null;
  us_ga_weeks: number | null;
  us_ga_days: number | null;
}

export interface HistoryPregnancyRowPatch {
  outcome: string;
  mode_of_delivery?: string;
  gestational_age_weeks?: number;
  birth_date?: string;
  notes?: string;
}

const OUTCOME_TO_HISTORY: Record<string, string> = {
  LIVE_BIRTH: 'LIVE_BIRTH',
  MISCARRIAGE: 'MISCARRIAGE',
  STILLBIRTH: 'STILLBIRTH',
  ECTOPIC: 'ECTOPIC',
  TERMINATION: 'ABORTION',
  TRANSFERRED: 'OTHER',
  LOST_TO_FOLLOWUP: 'OTHER',
  OTHER: 'OTHER',
};

const DELIVERY_MODE_TO_HISTORY: Record<string, string> = {
  VAGINAL: 'VAGINAL',
  CESAREAN: 'CESAREAN',
  ASSISTED: 'ASSISTED_VAGINAL',
};

export function historyRowPatchForClose(
  outcome: PregnancyOutcomeDto,
  dating: PregnancyDatingFields,
  now: Date,
): HistoryPregnancyRowPatch {
  const asOf = outcome.date ? new Date(outcome.date) : now;

  // US dating wins over LMP when a dated scan measurement exists.
  const usable =
    dating.us_dating_date != null &&
    (dating.us_ga_weeks != null || dating.us_ga_days != null);
  const ga = usable
    ? gaFromUsDating(
        dating.us_dating_date,
        dating.us_ga_weeks,
        dating.us_ga_days,
        asOf,
      )
    : gaFromLmp(dating.lmp, asOf);

  const patch: HistoryPregnancyRowPatch = {
    outcome: OUTCOME_TO_HISTORY[outcome.outcome_type] ?? 'OTHER',
    birth_date: asOf.toISOString().slice(0, 10),
  };
  if (outcome.outcome_type === 'LIVE_BIRTH' && outcome.delivery_mode) {
    patch.mode_of_delivery = DELIVERY_MODE_TO_HISTORY[outcome.delivery_mode];
  }
  if (ga) {
    patch.gestational_age_weeks = ga.weeks;
  }
  if (outcome.notes) {
    patch.notes = outcome.notes;
  }
  return patch;
}
