import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAllergyDto {
  @IsString() @MaxLength(200) allergy_to!: string;
  @IsString() @IsOptional() @MaxLength(2000) associated_symptoms?: string;
  @IsString() @IsOptional() @MaxLength(64) severity?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class UpdateAllergyDto {
  @IsString() @IsOptional() @MaxLength(200) allergy_to?: string;
  @IsString() @IsOptional() @MaxLength(2000) associated_symptoms?: string;
  @IsString() @IsOptional() @MaxLength(64) severity?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class AllergyDto {
  id!: string;
  patient_id!: string;
  allergy_to!: string;
  associated_symptoms!: string | null;
  severity!: string | null;
  notes!: string | null;
  created_by_id!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
