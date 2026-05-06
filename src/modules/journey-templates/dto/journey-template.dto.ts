export class EpisodeTemplateDto {
  id!: string;
  name!: string;
  order!: number;
}

export class JourneyTemplateDto {
  id!: string;
  specialty_id!: string;
  name!: string;
  type!: string;
  description!: string | null;
  episodes!: EpisodeTemplateDto[];
}
