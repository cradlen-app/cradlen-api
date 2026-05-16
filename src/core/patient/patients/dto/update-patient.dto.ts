import { IsString, IsOptional, IsDateString } from 'class-validator';

export class UpdatePatientDto {
  @IsString() @IsOptional() full_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() phone_number?: string;
  @IsString() @IsOptional() address?: string;
}
