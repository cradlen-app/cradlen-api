import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One PHI read-access record in the patient access-log report. */
export class PhiAccessLogEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'STAFF | PATIENT | ADMIN | SYSTEM' })
  actor_type!: string;

  @ApiPropertyOptional({ nullable: true })
  user_id!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profile_id!: string | null;

  @ApiPropertyOptional({ nullable: true })
  patient_account_id!: string | null;

  @ApiPropertyOptional({ nullable: true })
  organization_id!: string | null;

  @ApiProperty({ description: 'PATIENT | VISIT' })
  subject_type!: string;

  @ApiProperty()
  subject_id!: string;

  @ApiPropertyOptional({ nullable: true })
  patient_id!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty({ description: 'Logical surface tag, e.g. patient.detail' })
  resource!: string;

  @ApiProperty()
  route!: string;

  @ApiPropertyOptional({ nullable: true })
  purpose!: string | null;

  @ApiProperty()
  at!: Date;
}
