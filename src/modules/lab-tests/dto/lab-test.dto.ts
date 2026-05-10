export class LabTestDto {
  id!: string;
  organization_id!: string | null;
  code!: string;
  name!: string;
  category!: string;
  specialty_id!: string | null;
  added_by_id!: string | null;
  is_deleted!: boolean;
  created_at!: Date;
  updated_at!: Date;
}
