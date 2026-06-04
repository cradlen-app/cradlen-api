import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientMeResponseDto {
  @ApiProperty()
  user_id!: string;

  @ApiPropertyOptional({ nullable: true })
  patient_id!: string | null;

  @ApiPropertyOptional({ nullable: true })
  guardian_id!: string | null;

  @ApiProperty({ type: [String] })
  accessible_patient_ids!: string[];
}
