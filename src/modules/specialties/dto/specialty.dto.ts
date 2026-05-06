export class EpisodeTemplateDto {
  id: string;
  name: string;
  order: number;
}

export class JourneyTemplateInSpecialtyDto {
  id: string;
  name: string;
  type: string;
  description: string | null;
  episodes: EpisodeTemplateDto[];
}

export class SpecialtyDto {
  id: string;
  name: string;
  code: string;
  description: string | null;
  templates: JourneyTemplateInSpecialtyDto[];
}
