export class VisitHistoryMedicationDto {
  name!: string;
  dose!: string;
}

export class VisitHistorySummaryDto {
  id!: string;
  appointment_type!: string;
  completed_at!: Date;
  diagnosis!: string | null;
  medications!: VisitHistoryMedicationDto[];
  investigations!: string[];
}
