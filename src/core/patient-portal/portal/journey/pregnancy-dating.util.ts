/**
 * Pregnancy dating math, kept pure (no Prisma, no clock) so the service stays
 * a thin mapper and the arithmetic is unit-testable with an injected `now`.
 *
 * Term is 280 days (40 weeks) from the dating anchor. We prefer ultrasound
 * dating — the most accurate anchor once a scan exists — and fall back to the
 * last menstrual period (Naegele's rule). With neither anchor we can still
 * surface the rest of the pregnancy block, so every field here is nullable.
 */

const TERM_DAYS = 280;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PregnancyDatingInput {
  lmp: Date | null;
  us_dating_date: Date | null;
  us_ga_weeks: number | null;
  us_ga_days: number | null;
}

export interface PregnancyDating {
  /** Current gestational age (whole weeks) as of `now`, or null with no anchor. */
  gestationalAgeWeeks: number | null;
  /** Remaining days of the current gestational week (0–6), or null. */
  gestationalAgeDays: number | null;
  /** Estimated due date (term from the dating anchor), or null with no anchor. */
  estimatedDueDate: Date | null;
}

/** Whole days elapsed from `from` to `to` (floored, never negative). */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function splitGa(totalDays: number): {
  weeks: number;
  days: number;
} {
  return { weeks: Math.floor(totalDays / 7), days: totalDays % 7 };
}

/**
 * Computes current gestational age + EDD from a pregnancy record's dating
 * fields. Ultrasound dating wins when present (anchor date + GA-at-scan);
 * otherwise LMP + 280 days. Returns all-null when no anchor is recorded.
 */
export function computePregnancyDating(
  input: PregnancyDatingInput,
  now: Date,
): PregnancyDating {
  if (input.us_dating_date) {
    const gaAtScanDays = (input.us_ga_weeks ?? 0) * 7 + (input.us_ga_days ?? 0);
    const currentGaDays = gaAtScanDays + daysBetween(input.us_dating_date, now);
    const { weeks, days } = splitGa(currentGaDays);
    return {
      gestationalAgeWeeks: weeks,
      gestationalAgeDays: days,
      estimatedDueDate: addDays(input.us_dating_date, TERM_DAYS - gaAtScanDays),
    };
  }

  if (input.lmp) {
    const currentGaDays = daysBetween(input.lmp, now);
    const { weeks, days } = splitGa(currentGaDays);
    return {
      gestationalAgeWeeks: weeks,
      gestationalAgeDays: days,
      estimatedDueDate: addDays(input.lmp, TERM_DAYS),
    };
  }

  return {
    gestationalAgeWeeks: null,
    gestationalAgeDays: null,
    estimatedDueDate: null,
  };
}
