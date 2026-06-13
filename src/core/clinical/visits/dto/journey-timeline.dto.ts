import { VisitHistorySummaryDto } from './visit-history-summary.dto.js';

/** One episode in a patient's journey, with its completed visits nested under it. */
export class JourneyTimelineEpisodeDto {
  id!: string;
  name!: string;
  order!: number;
  status!: string;
  started_at!: Date | null;
  ended_at!: Date | null;
  visits!: VisitHistorySummaryDto[];
}

/** One patient journey, with its episodes (each carrying their visits). */
export class JourneyTimelineDto {
  id!: string;
  /** Display name, sourced from the journey template (e.g. "Pregnancy"). */
  name!: string;
  type!: string;
  status!: string;
  started_at!: Date;
  ended_at!: Date | null;
  episodes!: JourneyTimelineEpisodeDto[];
}
