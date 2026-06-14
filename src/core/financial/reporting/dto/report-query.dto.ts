import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ReportQueryDto {
  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  branch_id?: string;

  @ApiPropertyOptional({
    description:
      'Narrow to one provider (assigned doctor). Honored only for managers; ' +
      'non-managers are always forced to their own id server-side.',
  })
  @IsUUID('4')
  @IsOptional()
  doctor_id?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  date_from?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  date_to?: string;
}
