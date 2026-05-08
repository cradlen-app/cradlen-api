export class CalendarEventDto {
  id!: string;
  organization_id!: string;
  branch_id!: string | null;
  created_by_id!: string;
  patient_id!: string | null;
  type!: string;
  title!: string;
  description!: string | null;
  starts_at!: Date;
  ends_at!: Date;
  all_day!: boolean;
  status!: string;
  details!: Record<string, unknown>;
  participants!: Array<{ profile_id: string; role: string }>;
  created_at!: Date;
  updated_at!: Date;
}

export class CalendarEventConflictDto {
  profile_id!: string;
  kind!: 'EVENT' | 'VISIT' | 'OUT_OF_SCHEDULE';
  ref_id?: string;
  starts_at?: string;
  ends_at?: string;
  summary!: string;
}

export class CalendarEventWithConflictsDto {
  event!: CalendarEventDto;
  conflicts!: CalendarEventConflictDto[];
}
