import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNonGynSurgeryDto {
  @IsString() @MaxLength(200) surgery_name!: string;
  @IsDateString() @IsOptional() surgery_date?: string;
  @IsString() @IsOptional() @MaxLength(200) facility?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class UpdateNonGynSurgeryDto {
  @IsString() @IsOptional() @MaxLength(200) surgery_name?: string;
  @IsDateString() @IsOptional() surgery_date?: string;
  @IsString() @IsOptional() @MaxLength(200) facility?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class NonGynSurgeryDto {
  id!: string;
  patient_id!: string;
  surgery_name!: string;
  surgery_date!: Date | null;
  facility!: string | null;
  notes!: string | null;
  created_by_id!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
