import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListPortalHistoryQueryDto {
  @ApiPropertyOptional({
    description:
      'Target patient id (for guardian accounts with linked patients). Defaults to the caller.',
  })
  @IsOptional()
  @IsUUID()
  patient_id?: string;
}
