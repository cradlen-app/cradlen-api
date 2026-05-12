import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMedicationDto {
  @IsString() @IsOptional() @MinLength(1) @MaxLength(200) name?: string;
  @IsString() @IsOptional() @MaxLength(200) generic_name?: string;
  @IsString() @IsOptional() @MaxLength(64) form?: string;
  @IsString() @IsOptional() @MaxLength(64) strength?: string;
}
