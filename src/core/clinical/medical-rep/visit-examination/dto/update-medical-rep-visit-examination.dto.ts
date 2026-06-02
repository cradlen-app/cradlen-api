import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MedicalRepVisitOutcome, MedicalRepVisitPurpose } from '@prisma/client';

/**
 * One "product discussed" row. `medication_id` present = picked from the
 * catalog (detail fields ignored). Absent = a drug the doctor typed — the
 * server resolves-or-creates it in the org medication catalog (with
 * `added_by_id` provenance), persisting the supplied detail fields.
 */
export class ProductDiscussedDto {
  @IsUUID()
  @IsOptional()
  medication_id?: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  // Detail fields — used only when creating a brand-new catalog medication.
  @IsString() @IsOptional() @MaxLength(200) generic_name?: string;
  @IsString() @IsOptional() @MaxLength(100) form?: string;
  @IsString() @IsOptional() @MaxLength(100) strength?: string;
  @IsString() @IsOptional() @MaxLength(200) company?: string;
  @IsNumber() @IsOptional() @Min(0) default_dose_amount?: number;
  @IsString() @IsOptional() @MaxLength(50) default_dose_unit?: string;
  @IsString() @IsOptional() @MaxLength(100) default_dose_frequency?: string;
  @IsString() @IsOptional() @MaxLength(100) default_dose_route?: string;
}

/**
 * Bulk PATCH body for the medical-rep visit "examination" surface
 * (`PATCH /v1/medical-rep-visits/:id/examination`). Thin by design.
 *
 * `products` REPLACES the visit's discussed-medication set and each med is also
 * auto-added to the rep's promoted list (additive). Bindings for the scalar
 * fields land here flat (the FE maps the `MEDICAL_REP_VISIT` namespace to the
 * body root); `products` is supplied by the bespoke FE picker.
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
  @ValidateNested({ each: true })
  @Type(() => ProductDiscussedDto)
  @ArrayMaxSize(100)
  @IsOptional()
  products?: ProductDiscussedDto[];
}
