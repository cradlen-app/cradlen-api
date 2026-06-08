import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A recommended follow-up surfaced on the patient timeline. Derived from a
 * completed visit's `follow_up_date` ("come back by date X"), not from a
 * separately booked future appointment row.
 */
export class PatientUpcomingVisitItemDto {
  @ApiProperty({
    description: 'Id of the visit that recommended the follow-up',
  })
  id!: string;

  @ApiProperty({ description: 'The recommended return date' })
  follow_up_date!: Date;

  @ApiPropertyOptional({ nullable: true })
  follow_up_notes!: string | null;

  @ApiProperty({ description: 'Scheduled date of the recommending visit' })
  source_visit_date!: Date;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. OBGYN' })
  specialty_code!: string | null;

  @ApiPropertyOptional({ nullable: true })
  doctor_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  organization_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  branch_name!: string | null;
}
