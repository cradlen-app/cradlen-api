import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalRepVisitOutcome, MedicalRepVisitPurpose } from '@prisma/client';

/** A discussed-medication chip (id + readable name). */
export class DiscussedMedicationDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** Read-only rep context shown in the visit's Overview panel. */
export class MedicalRepVisitOverviewDto {
  @ApiProperty() full_name!: string;
  @ApiProperty() company_name!: string;
  @ApiPropertyOptional({ nullable: true }) specialty_focus!: string | null;
  @ApiPropertyOptional({ nullable: true }) last_visit_at!: string | null;
  @ApiProperty({ type: [String] }) promoted_medications!: string[];
}

/**
 * GET/PATCH envelope for the medical-rep visit examination surface. `overview`
 * is read-only context; the remaining fields are the editable "Visit" section.
 */
export class MedicalRepVisitExaminationEnvelopeDto {
  @ApiProperty() visit_id!: string;
  @ApiProperty() examination_version!: number;
  @ApiProperty() status!: string;
  @ApiProperty() updated_at!: Date;
  @ApiProperty({ type: MedicalRepVisitOverviewDto })
  overview!: MedicalRepVisitOverviewDto;
  @ApiPropertyOptional({ nullable: true, enum: MedicalRepVisitPurpose })
  purpose!: MedicalRepVisitPurpose | null;
  @ApiProperty() samples_received!: boolean;
  @ApiPropertyOptional({ nullable: true, enum: MedicalRepVisitOutcome })
  outcome!: MedicalRepVisitOutcome | null;
  @ApiPropertyOptional({ nullable: true }) follow_up_date!: string | null;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [DiscussedMedicationDto] })
  discussed_medications!: DiscussedMedicationDto[];
}
