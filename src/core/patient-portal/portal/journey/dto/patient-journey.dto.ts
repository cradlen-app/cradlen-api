import { ApiProperty } from '@nestjs/swagger';

/** Portal-facing status for a journey stage, derived from EpisodeStatus + order. */
export type PatientJourneyStageStatus = 'DONE' | 'CURRENT' | 'UPCOMING';

/**
 * One stage of the patient's journey (an episode), shaped for the portal
 * stepper. `status` is derived: the active episode is CURRENT, earlier
 * episodes DONE, later ones UPCOMING.
 */
export class PatientJourneyStageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'First Trimester' })
  name!: string;

  @ApiProperty({ example: 1 })
  order!: number;

  @ApiProperty({ enum: ['DONE', 'CURRENT', 'UPCOMING'], example: 'CURRENT' })
  status!: PatientJourneyStageStatus;
}

/**
 * Pregnancy summary for an OB/GYN journey. Present only when the active journey
 * carries a PregnancyJourneyRecord. GA + EDD are computed server-side from the
 * record's dating fields so the portal needs no clinical math; both are null
 * when no dating anchor (ultrasound or LMP) has been recorded yet.
 */
export class PatientPregnancyDto {
  @ApiProperty({ nullable: true, example: 12 })
  gestational_age_weeks!: number | null;

  @ApiProperty({ nullable: true, example: 3 })
  gestational_age_days!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  estimated_due_date!: Date | null;

  @ApiProperty({ nullable: true, example: 2 })
  number_of_fetuses!: number | null;

  @ApiProperty({ nullable: true, example: 'twin' })
  pregnancy_type!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Boy & Girl',
    description: 'Free-text fetal sex(es) as recorded by the clinic',
  })
  fetal_sexes!: string | null;

  @ApiProperty({ nullable: true, example: 'high' })
  risk_level!: string | null;
}

/**
 * The patient's single active journey, shaped for the portal home dashboard:
 * the care-path type (so the UI can pick a hero variant), the ordered stages
 * for the stepper, and an optional pregnancy block. `pregnancy` is null for any
 * non-pregnancy care path; the whole response is absent (204/null) when the
 * patient has no active journey.
 */
export class PatientJourneyDto {
  @ApiProperty({ format: 'uuid' })
  journey_id!: string;

  @ApiProperty({ nullable: true, example: 'OBGYN_PREGNANCY' })
  care_path_code!: string | null;

  @ApiProperty({ nullable: true, example: 'OBGYN' })
  specialty_code!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Pregnancy',
    description: 'Care path display name',
  })
  label!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  started_at!: Date;

  @ApiProperty({ type: [PatientJourneyStageDto] })
  stages!: PatientJourneyStageDto[];

  @ApiProperty({ type: PatientPregnancyDto, nullable: true })
  pregnancy!: PatientPregnancyDto | null;
}
