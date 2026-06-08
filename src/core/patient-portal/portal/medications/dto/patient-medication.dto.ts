import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientMedicationItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Catalog name, or the free-typed drug name' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  generic_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  strength!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. tablet, capsule' })
  form!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. Supplement' })
  category!: string | null;

  @ApiProperty()
  dose!: string;

  @ApiProperty()
  frequency!: string;

  @ApiPropertyOptional({ nullable: true })
  duration!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. after meals' })
  instructions!: string | null;

  @ApiPropertyOptional({ nullable: true })
  route!: string | null;

  @ApiProperty({ description: 'Date of the visit the drug was prescribed at' })
  visit_date!: Date;

  @ApiProperty()
  prescribed_at!: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Computed end of the course; null when open-ended/unknown',
  })
  end_date!: Date | null;

  @ApiProperty()
  is_current!: boolean;

  @ApiPropertyOptional({ nullable: true })
  doctor_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  clinic_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  organization_name!: string | null;
}

export class PatientMedicationsResponseDto {
  @ApiProperty({ type: [PatientMedicationItemDto] })
  current!: PatientMedicationItemDto[];

  @ApiProperty({ type: [PatientMedicationItemDto] })
  past!: PatientMedicationItemDto[];
}
