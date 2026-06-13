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

/**
 * Today's operational visit counts for a branch (or a specific `date`), powering
 * the visits-page stat cards. Unlike {@link VisitStatsDto} these are plain
 * single-day counts — visits are counted by `scheduled_at` falling within the
 * day's bounds (matching the waiting-list view), `is_deleted: false`, regardless
 * of status. `total_visits` covers the clinical Visit table (VISIT + FOLLOW_UP);
 * `medical_reps` is the separate medical-rep-visit entity, reported alongside.
 */
export class VisitTodayStatsDto {
  /** Clinical visits scheduled for the day (VISIT + FOLLOW_UP). */
  total_visits!: number;
  /** `appointment_type = VISIT`. */
  visits!: number;
  /** `appointment_type = FOLLOW_UP`. */
  follow_ups!: number;
  /** Medical-rep visits scheduled for the day. */
  medical_reps!: number;
}
