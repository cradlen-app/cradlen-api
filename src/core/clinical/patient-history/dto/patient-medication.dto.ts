import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePatientMedicationDto {
  @IsString() @MaxLength(200) drug_name!: string;
  @IsUUID() @IsOptional() medication_id?: string;
  @IsString() @IsOptional() @MaxLength(200) indication?: string;
  @IsString() @IsOptional() @MaxLength(64) dose?: string;
  @IsString() @IsOptional() @MaxLength(64) frequency?: string;
  @IsDateString() @IsOptional() from_date?: string;
  @IsDateString() @IsOptional() to_date?: string;
  @IsBoolean() @IsOptional() is_ongoing?: boolean;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class UpdatePatientMedicationDto {
  @IsString() @IsOptional() @MaxLength(200) drug_name?: string;
  @IsUUID() @IsOptional() medication_id?: string;
  @IsString() @IsOptional() @MaxLength(200) indication?: string;
  @IsString() @IsOptional() @MaxLength(64) dose?: string;
  @IsString() @IsOptional() @MaxLength(64) frequency?: string;
  @IsDateString() @IsOptional() from_date?: string;
  @IsDateString() @IsOptional() to_date?: string;
  @IsBoolean() @IsOptional() is_ongoing?: boolean;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class PatientMedicationDto {
  id!: string;
  patient_id!: string;
  medication_id!: string | null;
  drug_name!: string;
  indication!: string | null;
  dose!: string | null;
  frequency!: string | null;
  from_date!: Date | null;
  to_date!: Date | null;
  is_ongoing!: boolean;
  notes!: string | null;
  created_by_id!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
