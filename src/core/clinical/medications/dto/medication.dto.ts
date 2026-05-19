export class MedicationDto {
  id!: string;
  organization_id!: string | null;
  code!: string;
  name!: string;
  generic_name!: string | null;
  form!: string | null;
  strength!: string | null;
  category!: string | null;
  company!: string | null;
  notes!: string | null;
  default_dose_amount!: number | null;
  default_dose_unit!: string | null;
  default_dose_frequency!: string | null;
  default_dose_route!: string | null;
  added_by_id!: string | null;
  is_deleted!: boolean;
  created_at!: Date;
  updated_at!: Date;
}

export class MedicationPrescriberDto {
  profile_id!: string;
  full_name!: string;
  count!: number;
}

export class MedicalRepLinkDto {
  id!: string;
  full_name!: string;
  company_name!: string;
}

export class MedicationWithStatsDto extends MedicationDto {
  total_prescriptions!: number;
  top_prescribers!: MedicationPrescriberDto[];
  medical_reps!: MedicalRepLinkDto[];
}
