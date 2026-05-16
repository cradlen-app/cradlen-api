// HH:MM ↔ minutes-from-midnight conversions for WorkingShift persistence.
// DTOs and API surface stay in HH:MM; storage is `Int` minutes (orderable,
// no locale parsing, CHECK-constrained).

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
