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
  /**
   * Ordered codes of the patient-history sections relevant to this care path —
   * the embedded `history_*` sections the OB/GYN examination surfaces once this
   * path is chosen. Resolved from `CarePathHistorySection`. Empty when none.
   */
  history_section_codes!: string[];
}
