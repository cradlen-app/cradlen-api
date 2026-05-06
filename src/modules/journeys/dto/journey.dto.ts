export class EpisodeDto {
  id!: string;
  name!: string;
  order!: number;
  status!: string;
  started_at!: Date | null;
  ended_at!: Date | null;
}

export class JourneyDto {
  id!: string;
  patient_id!: string;
  organization_id!: string;
  journey_template_id!: string;
  status!: string;
  started_at!: Date;
  ended_at!: Date | null;
  episodes!: EpisodeDto[];
}
