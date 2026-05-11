export class MedicalRepDto {
  id!: string;
  organization_id!: string;
  full_name!: string;
  company!: string;
  phone!: string | null;
  email!: string | null;
  territory!: string | null;
  notes!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
