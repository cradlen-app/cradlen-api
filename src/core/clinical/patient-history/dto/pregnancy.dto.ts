import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePregnancyDto {
  @IsDateString() @IsOptional() birth_date?: string;
  @IsString() @IsOptional() @MaxLength(64) outcome?: string;
  @IsString() @IsOptional() @MaxLength(64) mode_of_delivery?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(45)
  gestational_age_weeks?: number;
  @IsString() @IsOptional() @MaxLength(64) neonatal_outcome?: string;
  @IsString() @IsOptional() @MaxLength(2000) complications?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class UpdatePregnancyDto {
  @IsDateString() @IsOptional() birth_date?: string;
  @IsString() @IsOptional() @MaxLength(64) outcome?: string;
  @IsString() @IsOptional() @MaxLength(64) mode_of_delivery?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(45)
  gestational_age_weeks?: number;
  @IsString() @IsOptional() @MaxLength(64) neonatal_outcome?: string;
  @IsString() @IsOptional() @MaxLength(2000) complications?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class PregnancyDto {
  id!: string;
  patient_id!: string;
  birth_date!: Date | null;
  outcome!: string | null;
  mode_of_delivery!: string | null;
  gestational_age_weeks!: number | null;
  neonatal_outcome!: string | null;
  complications!: string | null;
  notes!: string | null;
  created_by_id!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
