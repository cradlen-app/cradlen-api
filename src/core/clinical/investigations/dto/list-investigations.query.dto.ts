import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvestigationStatus, LabTestCategory } from '@prisma/client';

/**
 * Query for the staff-side "patient attachments" list: the patient's
 * investigations (lab tests & imaging) that carry result files. Mirrors the
 * patient-portal list query, but `patient_id` is required (staff act on a
 * specific patient, not their own linked patients).
 */
export class ListInvestigationsQueryDto {
  @ApiProperty({ description: 'Target patient id' })
  @IsUUID()
  patient_id!: string;

  @ApiPropertyOptional({
    enum: InvestigationStatus,
    description: 'Filter by status (ORDERED | RESULTED | REVIEWED | CANCELLED)',
  })
  @IsOptional()
  @IsEnum(InvestigationStatus)
  status?: InvestigationStatus;

  @ApiPropertyOptional({
    enum: LabTestCategory,
    description: 'Filter by type (LAB | IMAGING | OTHER)',
  })
  @IsOptional()
  @IsEnum(LabTestCategory)
  type?: LabTestCategory;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
