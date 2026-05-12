import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// JSON sub-shapes — kept lightweight; class-validator enforces only top-level
// presence and basic typing. Free-form fields stay free-form to match early-
// phase UI iteration. See the JSON Promotion Rule in the design doc for when
// any of these should graduate to relational tables.

export class GynecologicalBaselineDto {
  @IsOptional() @IsNumber() age_at_menarche?: number;
  @IsOptional() @IsString() cycle_regularity?: string;
  @IsOptional() @IsString() duration?: string;
  @IsOptional() @IsString() flow?: string;
  @IsOptional() @IsString() dysmenorrhea?: string;
}

export class GynecologicProceduresDto {
  @IsOptional() @IsArray() @IsString({ each: true }) items?: string[];
  @IsOptional() @IsString() notes?: string;
}

export class ScreeningHistoryDto {
  @IsOptional() @IsString() pap_smear?: string;
  @IsOptional() @IsString() pap_smear_date?: string;
  @IsOptional() @IsString() mammography?: string;
  @IsOptional() @IsString() mammography_date?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) vaccines?: string[];
}

export class MedicalChronicIllnessesDto {
  @IsOptional() @IsArray() @IsString({ each: true }) items?: string[];
  @IsOptional() @IsString() notes?: string;
}

export class FamilyHistoryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gynecologic_cancers?: string[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chronic_illnesses?: string[];
  @IsOptional() @IsString() genetic_disorders?: string;
}

export class FertilityHistoryDto {
  @IsOptional() @IsString() duration_of_infertility?: string;
  @IsOptional() @IsString() partner_fertility_status?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) treatments?: string[];
  @IsOptional() @IsString() menstrual_ovulation_patterns?: string;
  @IsOptional() @IsString() past_pregnancies_outcomes?: string;
}

export class SocialHistoryDto {
  @IsOptional() @IsString() smoking?: string;
  @IsOptional() @IsString() alcohol?: string;
  @IsOptional() @IsString() occupation?: string;
}

/**
 * Bulk PATCH body for the OB/GYN history tab. Every field is optional —
 * unsent sections are left untouched on the server. One PATCH = one
 * row update = one revision shadow row = one `patient.history.updated`
 * event listing the sections that actually changed.
 */
export class UpdateObgynHistoryDto {
  @IsOptional() @IsString() husband_name?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GynecologicalBaselineDto)
  gynecological_baseline?: GynecologicalBaselineDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GynecologicProceduresDto)
  gynecologic_procedures?: GynecologicProceduresDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ScreeningHistoryDto)
  screening_history?: ScreeningHistoryDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MedicalChronicIllnessesDto)
  medical_chronic_illnesses?: MedicalChronicIllnessesDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FamilyHistoryDto)
  family_history?: FamilyHistoryDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FertilityHistoryDto)
  fertility_history?: FertilityHistoryDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SocialHistoryDto)
  social_history?: SocialHistoryDto;
}

export class PatientObgynHistoryDto {
  patient_id!: string;
  husband_name!: string | null;
  gynecological_baseline!: unknown;
  gynecologic_procedures!: unknown;
  screening_history!: unknown;
  obstetric_summary!: unknown;
  medical_chronic_illnesses!: unknown;
  family_history!: unknown;
  fertility_history!: unknown;
  social_history!: unknown;
  version!: number;
  @Type(() => Date) updated_at!: Date;
}
