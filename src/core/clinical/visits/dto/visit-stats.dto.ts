/** A single visit metric: count within the current vs the previous calendar month. */
export class VisitStatMetricDto {
  current!: number;
  previous!: number;
}

/** One day's attended-visit counts within the current month (drives the trend chart). */
export class VisitDailyPointDto {
  /** Local-time day, `YYYY-MM-DD`. */
  date!: string;
  visits!: number;
  follow_ups!: number;
}

/**
 * Monthly visit analytics for a branch (or org-wide for owners). Unlike the
 * cumulative patient/staff snapshots, these are **period flows**: each metric
 * counts attended visits (`checked_in_at` set) that fell within the current
 * calendar month vs the previous one, so the month-over-month trend reflects
 * throughput. The `{ current, previous }` shape matches the patient/staff DTOs
 * so the frontend trend chip is reused unchanged.
 */
export class VisitStatsDto {
  /** All attended visits, regardless of appointment type. */
  total!: VisitStatMetricDto;
  /** `appointment_type = VISIT`. */
  visits!: VisitStatMetricDto;
  /** `appointment_type = FOLLOW_UP`. */
  follow_ups!: VisitStatMetricDto;
  /** Per-day series for the current month. */
  daily!: VisitDailyPointDto[];
}
