export class EnumOptionDto {
  code!: string;
  name!: string;
}

export class ProfileLookupsDto {
  executive_titles!: EnumOptionDto[];
  engagement_types!: EnumOptionDto[];
}
