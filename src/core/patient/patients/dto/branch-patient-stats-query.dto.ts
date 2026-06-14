import { IsBoolean, IsOptional } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BranchPatientStatsQueryDto {
  @ApiPropertyOptional({
    description:
      'Deprecated/ignored: scope is derived server-side from the caller role (a doctor always sees only their own patients). Accepted for backward-compat.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  assigned_to_me?: boolean;
}
