export class EpisodeTemplateDto {
  id!: string;
  name!: string;
  order!: number;
}

export class JourneyTemplateInSpecialtyDto {
  id!: string;
  name!: string;
  type!: string;
  description!: string | null;
  episodes!: EpisodeTemplateDto[];
}

export class SubspecialtyLookupDto {
  code!: string;
  name!: string;
  /** Parent specialty code. */
  specialty_code!: string;
}

export class SpecialtyLookupDto {
  code!: string;
  name!: string;
  subspecialties!: { code: string; name: string }[];
}

export class SpecialtyDto {
  id!: string;
  name!: string;
  code!: string;
  description!: string | null;
  templates!: JourneyTemplateInSpecialtyDto[];
  subspecialties!: { id: string; code: string; name: string }[];
}
