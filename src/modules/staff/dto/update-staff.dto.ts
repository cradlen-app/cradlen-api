import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  role_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;
}
