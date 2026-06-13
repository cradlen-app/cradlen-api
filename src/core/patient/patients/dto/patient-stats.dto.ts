import { JourneyTemplateType } from '@prisma/client';

/** A single metric with its current value and the value at the start of this month. */
export class PatientStatMetricDto {
  current!: number;
  previous!: number;
}

/**
 * Patient count for one care-path journey, keyed by the journey **template**
 * (which belongs to a `Specialty`). The breakdown is discovered from data, so a
 * new specialty's care paths surface here without code changes — `type` is only
 * an icon hint on the client, never the source of the card set.
 */
export class CarePathStatDto {
  journey_template_id!: string;
  name!: string;
  specialty_id!: string;
  specialty_name!: string;
  type!: JourneyTemplateType;
  current!: number;
  previous!: number;
}

export class PatientStatsDto {
  total!: PatientStatMetricDto;
  /** Dynamic, data-driven list (not a fixed-length enum list). */
  by_care_path!: CarePathStatDto[];
}
