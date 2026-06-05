import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientInvestigationItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: 'Catalog test name, or the free-typed test name',
  })
  test_name!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'LAB | IMAGING | OTHER',
  })
  type!: string | null;

  @ApiProperty({ description: 'ORDERED | RESULTED | REVIEWED | CANCELLED' })
  status!: string;

  @ApiProperty({ description: 'When the investigation was ordered' })
  ordered_at!: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Instructions / notes for the patient',
  })
  instructions!: string | null;

  @ApiPropertyOptional({ nullable: true })
  ordered_by_name!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When a doctor reviewed the result',
  })
  reviewed_at!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reviewing doctor; only set once the result is REVIEWED',
  })
  reviewed_by_name!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Result text; null until the result is REVIEWED by a doctor',
  })
  result_text!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Result attachment URL; null until the result is REVIEWED by a doctor',
  })
  result_attachment_url!: string | null;

  @ApiProperty()
  visit_id!: string;

  @ApiProperty({ description: 'Scheduled date of the visit' })
  visit_date!: Date;

  @ApiPropertyOptional({ nullable: true })
  organization_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  branch_name!: string | null;
}
