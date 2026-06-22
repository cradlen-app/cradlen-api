import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { MaritalStatus } from '@prisma/client';

export class UpdatePatientDto {
  @IsString() @IsOptional() full_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() phone_number?: string;
  @IsString() @IsOptional() address?: string;
  @IsEnum(MaritalStatus) @IsOptional() marital_status?: MaritalStatus;
}
