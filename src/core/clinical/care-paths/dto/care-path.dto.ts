export class CarePathEpisodeDto {
  id!: string;
  code!: string;
  name!: string;
  order!: number;
  organization_id!: string | null;
  is_system!: boolean;
}

export class CarePathDto {
  id!: string;
  specialty_id!: string;
  organization_id!: string | null;
  is_system!: boolean;
  parent_id!: string | null;
  code!: string;
  name!: string;
  description!: string | null;
  order!: number;
  episodes!: CarePathEpisodeDto[];
}
