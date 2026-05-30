import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMedicationDto {
  @IsString() @MinLength(1) @MaxLength(64) code!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsString() @IsOptional() @MaxLength(200) generic_name?: string;
  @IsString() @IsOptional() @MaxLength(64) form?: string;
  @IsString() @IsOptional() @MaxLength(64) strength?: string;
  @IsString() @IsOptional() @MaxLength(100) category?: string;
  @IsString() @IsOptional() @MaxLength(200) company?: string;
  @IsString() @IsOptional() @MaxLength(1000) notes?: string;
  @IsNumber() @IsOptional() @Min(0) @Max(99999) default_dose_amount?: number;
  @IsString() @IsOptional() @MaxLength(32) default_dose_unit?: string;
  @IsString() @IsOptional() @MaxLength(64) default_dose_frequency?: string;
  @IsString() @IsOptional() @MaxLength(64) default_dose_route?: string;
}
