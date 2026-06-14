import { IsBoolean, IsOptional } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BranchPatientStatsQueryDto {
  @ApiPropertyOptional({
    description:
      'When true, restricts the analytics to patients whose qualifying visit at the branch was assigned to the current doctor (their own patients).',
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  assigned_to_me?: boolean;
}
