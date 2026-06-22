import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class InvestigationAttachmentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Short-lived presigned GET URL for the file' })
  url!: string;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. application/pdf' })
  content_type!: string | null;
}

export class InvestigationReviewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  patient_name!: string;

  @ApiProperty()
  visit_id!: string;

  @ApiProperty({ description: 'ORDERED | RESULTED | REVIEWED | CANCELLED' })
  status!: string;

  @ApiPropertyOptional({ nullable: true, description: 'LAB | IMAGING | OTHER' })
  type!: string | null;

  @ApiProperty({
    description: 'Catalog test name, or the free-typed test name',
  })
  test_name!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The order instructions / reason',
  })
  reason!: string | null;

  @ApiProperty()
  updated_at!: Date;

  @ApiPropertyOptional({
    nullable: true,
    description: "The doctor's review notes (stored as result_text)",
  })
  doctor_notes!: string | null;

  @ApiProperty({ type: [InvestigationAttachmentDto] })
  result_attachments!: InvestigationAttachmentDto[];
}

/** One result file in the staff-side attachments list. */
export class InvestigationAttachmentItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Short-lived presigned GET URL for the file' })
  url!: string;

  @ApiPropertyOptional({ nullable: true, description: 'e.g. application/pdf' })
  content_type!: string | null;

  @ApiProperty({ description: 'When the file was uploaded' })
  uploaded_at!: Date;

  @ApiProperty({ description: 'PATIENT | CLINIC | EXTERNAL_LAB' })
  source!: string;
}

/**
 * One investigation (with its result files) in the patient's attachments list,
 * shown on the visit-workspace Overview tab. Unlike the patient portal, clinic
 * users see every non-deleted attachment regardless of review state.
 */
export class InvestigationAttachmentsItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: 'Catalog test name, or the free-typed test name',
  })
  test_name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'LAB | IMAGING | OTHER' })
  type!: string | null;

  @ApiProperty({ description: 'ORDERED | RESULTED | REVIEWED | CANCELLED' })
  status!: string;

  @ApiProperty({ description: 'When the investigation was ordered' })
  ordered_at!: Date;

  @ApiProperty()
  visit_id!: string;

  @ApiProperty({ description: 'Scheduled date of the visit' })
  visit_date!: Date;

  @ApiProperty({ type: [InvestigationAttachmentItemDto] })
  result_attachments!: InvestigationAttachmentItemDto[];
}

export class ReviewInvestigationDto {
  @ApiPropertyOptional({ description: "The doctor's review notes" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
