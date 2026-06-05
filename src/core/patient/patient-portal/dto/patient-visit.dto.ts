import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientVisitDiagnosisDto {
  @ApiProperty({ description: 'ICD-10 code, e.g. "N80.0"' })
  code!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  is_primary!: boolean;
}

export class PatientVisitMedicationDto {
  @ApiProperty({ description: 'Catalog name, or the free-typed drug name' })
  name!: string;

  @ApiProperty()
  dose!: string;

  @ApiProperty()
  frequency!: string;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. oral, IV' })
  route!: string | null;

  @ApiPropertyOptional({ nullable: true })
  duration!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. after meals' })
  instructions!: string | null;
}

export class PatientVisitInvestigationDto {
  @ApiProperty({
    description: 'Catalog test name, or the free-typed test name',
  })
  name!: string;

  @ApiProperty({ description: 'ORDERED | RESULTED | REVIEWED | CANCELLED' })
  status!: string;
}

export class PatientVisitItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Scheduled date of the visit' })
  visit_date!: Date;

  @ApiProperty({ description: 'When the visit was completed' })
  completed_at!: Date;

  @ApiProperty({ description: 'VISIT | FOLLOW_UP' })
  appointment_type!: string;

  @ApiProperty({ description: 'NORMAL | EMERGENCY' })
  priority!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. OBGYN' })
  specialty_code!: string | null;

  @ApiPropertyOptional({ nullable: true })
  doctor_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  organization_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  branch_name!: string | null;

  @ApiProperty({ type: [PatientVisitDiagnosisDto] })
  diagnoses!: PatientVisitDiagnosisDto[];

  @ApiProperty({ type: [PatientVisitMedicationDto] })
  medications!: PatientVisitMedicationDto[];

  @ApiProperty({ type: [PatientVisitInvestigationDto] })
  investigations!: PatientVisitInvestigationDto[];
}
