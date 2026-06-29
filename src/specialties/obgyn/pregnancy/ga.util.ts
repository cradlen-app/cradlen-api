/**
 * Gestational age + estimated delivery date math for the pregnancy clinical
 * surface. Pure and deterministic (Naegele's rule) — no Prisma, no clock reads.
 * The caller passes `asOf` (the visit date) so a historical visit shows the GA
 * that was true at that encounter, not today's.
 *
 * Two independent dating references:
 *   - LMP: EDD = LMP + 280 days; GA = (asOf − LMP).
 *   - US dating: a scan on `usDate` measured the fetus at `usWeeks+usDays`. That
 *     fixes the timeline, so EDD = usDate + (280 − usAgeDays) and
 *     GA(asOf) = usAgeDays + (asOf − usDate).
 *
 * All arithmetic is in whole UTC days (time-of-day stripped) to avoid DST drift.
 * Negative ages clamp to 0w0d; missing inputs return null.
 */

const FULL_TERM_DAYS = 280;

export interface GestationalAge {
  weeks: number;
  days: number;
}

/** Day number at UTC midnight (days since epoch), or null for a missing date. */
function utcDay(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Math.floor(ms / 86_400_000);
}

/** Build a UTC-midnight Date `offset` days after the given day number. */
function dayToDate(dayNumber: number): Date {
  return new Date(dayNumber * 86_400_000);
}

function ageFromDays(totalDays: number): GestationalAge {
  const clamped = totalDays < 0 ? 0 : totalDays;
  return { weeks: Math.floor(clamped / 7), days: clamped % 7 };
}

function usAgeInDays(
  usWeeks: number | null | undefined,
  usDays: number | null | undefined,
): number | null {
  if (usWeeks == null && usDays == null) return null;
  return (usWeeks ?? 0) * 7 + (usDays ?? 0);
}

export function eddFromLmp(lmp: Date | null | undefined): Date | null {
  const day = utcDay(lmp);
  return day == null ? null : dayToDate(day + FULL_TERM_DAYS);
}

export function gaFromLmp(
  lmp: Date | null | undefined,
  asOf: Date | null | undefined,
): GestationalAge | null {
  const lmpDay = utcDay(lmp);
  const asOfDay = utcDay(asOf);
  if (lmpDay == null || asOfDay == null) return null;
  return ageFromDays(asOfDay - lmpDay);
}

export function eddFromUsDating(
  usDate: Date | null | undefined,
  usWeeks: number | null | undefined,
  usDays: number | null | undefined,
): Date | null {
  const usDay = utcDay(usDate);
  const ageDays = usAgeInDays(usWeeks, usDays);
  if (usDay == null || ageDays == null) return null;
  return dayToDate(usDay + (FULL_TERM_DAYS - ageDays));
}

export function gaFromUsDating(
  usDate: Date | null | undefined,
  usWeeks: number | null | undefined,
  usDays: number | null | undefined,
  asOf: Date | null | undefined,
): GestationalAge | null {
  const usDay = utcDay(usDate);
  const asOfDay = utcDay(asOf);
  const ageDays = usAgeInDays(usWeeks, usDays);
  if (usDay == null || asOfDay == null || ageDays == null) return null;
  return ageFromDays(ageDays + (asOfDay - usDay));
}

/** "12w 3d" for display, or null. */
export function formatGa(ga: GestationalAge | null): string | null {
  if (!ga) return null;
  return `${ga.weeks}w ${ga.days}d`;
}

/** "YYYY-MM-DD" (UTC) for display, or null. */
export function formatEdd(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}
