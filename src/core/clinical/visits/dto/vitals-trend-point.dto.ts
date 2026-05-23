export class VitalsTrendPointDto {
  visit_id!: string;
  completed_at!: Date;
  systolic_bp!: number | null;
  diastolic_bp!: number | null;
  weight_kg!: number | null;
  bmi!: number | null;
}
