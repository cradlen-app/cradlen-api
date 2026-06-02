import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MedicalRepVisitOutcome, MedicalRepVisitPurpose } from '@prisma/client';

/**
 * Bulk PATCH body for the medical-rep visit "examination" surface
 * (`PATCH /v1/medical-rep-visits/:id/examination`). Thin by design — the
 * template (`medical_rep_visit`) owns any conditional logic via predicates.
 *
 * `medication_ids` REPLACES the visit's `MedicalRepVisitMedication` set (the
 * "Products discussed" multi-picker). Bindings land here flat (the FE maps the
 * `MEDICAL_REP_VISIT` namespace to the body root).
 */
export class UpdateMedicalRepVisitExaminationDto {
  @IsEnum(MedicalRepVisitPurpose)
  @IsOptional()
  purpose?: MedicalRepVisitPurpose;

  @IsBoolean()
  @IsOptional()
  samples_received?: boolean;

  @IsEnum(MedicalRepVisitOutcome)
  @IsOptional()
  outcome?: MedicalRepVisitOutcome;

  @IsDateString()
  @IsOptional()
  follow_up_date?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsOptional()
  medication_ids?: string[];
}
