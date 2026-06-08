/**
 * Prescription `duration` is free text ("1 month", "7 days", "2 weeks").
 * Compute the course end date from the prescription start. Returns `null` for
 * empty/unparseable input — the caller treats that as open-ended (ongoing).
 *
 * Date math uses UTC so it matches the `@db.Date`/`DateTime` values Prisma
 * returns and stays free of host-timezone drift.
 */
export function computeMedicationEndDate(
  start: Date,
  duration: string | null | undefined,
): Date | null {
  if (!duration) return null;
  const match =
    /^\s*(\d+)\s*(days?|weeks?|months?|years?|d|w|mo|m|y)\s*$/i.exec(duration);
  if (!match) return null;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  const end = new Date(start.getTime());

  if (unit === 'd' || unit.startsWith('day')) {
    end.setUTCDate(end.getUTCDate() + amount);
  } else if (unit === 'w' || unit.startsWith('week')) {
    end.setUTCDate(end.getUTCDate() + amount * 7);
  } else if (unit === 'mo' || unit === 'm' || unit.startsWith('month')) {
    end.setUTCMonth(end.getUTCMonth() + amount);
  } else if (unit === 'y' || unit.startsWith('year')) {
    end.setUTCFullYear(end.getUTCFullYear() + amount);
  } else {
    return null;
  }

  return end;
}
