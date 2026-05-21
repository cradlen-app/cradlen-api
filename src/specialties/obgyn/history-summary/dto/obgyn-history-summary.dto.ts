export class AllergySnapshotDto {
  allergy_to!: string;
  severity!: string;
  associated_symptoms!: string | null;
}

export class MedicationSnapshotDto {
  drug_name!: string;
  dose!: string | null;
  frequency!: string | null;
  is_ongoing!: boolean;
}

export class ObgynHistorySummaryDto {
  history_exists!: boolean;
  allergies!: AllergySnapshotDto[];
  current_medications!: MedicationSnapshotDto[];
  obstetric_summary!: unknown | null;
  gynecological_baseline!: unknown | null;
  chronic_illnesses!: unknown | null;
  family_history!: unknown | null;
  social_history!: unknown | null;
  screening_status!: unknown | null;
  section_timestamps!: Record<string, string> | null;
}
