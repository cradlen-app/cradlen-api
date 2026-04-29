import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateAccountProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_clinical?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;
}
