import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvestigationStatus, LabTestCategory } from '@prisma/client';

export class ListPatientInvestigationsQueryDto {
  @ApiPropertyOptional({
    description:
      'Target patient id (for guardian accounts with linked patients)',
  })
  @IsOptional()
  @IsUUID()
  patient_id?: string;

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

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
