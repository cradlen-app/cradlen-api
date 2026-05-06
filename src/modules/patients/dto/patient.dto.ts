export class PatientDto {
  id!: string;
  national_id!: string;
  full_name!: string;
  husband_name!: string | null;
  date_of_birth!: Date;
  phone_number!: string;
  address!: string;
  created_at!: Date;
}

export class EpisodeSummaryDto {
  id!: string;
  name!: string;
  order!: number;
}

export class PatientLookupDto extends PatientDto {
  active_episodes!: EpisodeSummaryDto[];
}

export class ActiveJourneyDto {
  id!: string;
  type!: string;
  status!: string;
}

export class BranchPatientDto extends PatientDto {
  journey!: ActiveJourneyDto | null;
}
