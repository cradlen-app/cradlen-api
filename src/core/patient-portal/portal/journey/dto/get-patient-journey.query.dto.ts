import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetPatientJourneyQueryDto {
  @ApiPropertyOptional({
    description:
      'Target patient id (for guardian accounts with linked patients)',
  })
  @IsOptional()
  @IsUUID()
  patient_id?: string;
}
