/** Start (00:00:00.000) and end (23:59:59.999) of the calendar day of `date`. */
export function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Convenience for the current day's bounds. */
export function todayBounds(): { start: Date; end: Date } {
  return dayBounds(new Date());
}
