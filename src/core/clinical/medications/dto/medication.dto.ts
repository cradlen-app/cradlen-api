export class MedicationDto {
  id!: string;
  organization_id!: string | null;
  code!: string;
  name!: string;
  generic_name!: string | null;
  form!: string | null;
  strength!: string | null;
  added_by_id!: string | null;
  is_deleted!: boolean;
  created_at!: Date;
  updated_at!: Date;
}
