import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ListPatientMedicationsQueryDto {
  /**
   * Which patient's medications to return. Only meaningful for a guardian
   * account that can access more than one patient; must be one of the
   * caller's accessible patients. Omitted for a patient account.
   */
  @ApiPropertyOptional({ description: 'Target patient id (guardian accounts)' })
  @IsOptional()
  @IsUUID()
  patient_id?: string;
}
