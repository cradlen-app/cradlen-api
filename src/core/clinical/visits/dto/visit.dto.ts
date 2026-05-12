export class VisitDto {
  id!: string;
  episode_id!: string;
  assigned_doctor_id!: string;
  branch_id!: string;
  appointment_type!: string;
  priority!: string;
  status!: string;
  scheduled_at!: Date;
  checked_in_at!: Date | null;
  started_at!: Date | null;
  completed_at!: Date | null;
  notes!: string | null;
  queue_number!: number | null;
  created_by_id!: string;
  created_at!: Date;
}
