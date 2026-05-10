import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SHORT = 256;
const LONG = 5000;

/** Gynecological → Menstrual History (form section) */
export class GynecologicalBaselineDto {
  @IsOptional() @IsInt() @Min(5) @Max(25) age_at_menarche?: number;
  @IsString() @IsOptional() @MaxLength(SHORT) cycle_regularity?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) duration?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) flow?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) dysmenorrhea?: string;
}

/** Gynecological → Past Procedures (checkbox set) */
export class GynecologicProceduresDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  items?: string[];
  @IsString() @IsOptional() @MaxLength(LONG) notes?: string;
}

/** Gynecological → Screening & Vaccinations */
export class ScreeningHistoryDto {
  @IsString() @IsOptional() @MaxLength(SHORT) pap_smear?: string;
  @IsDateString() @IsOptional() pap_smear_date?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) mammography?: string;
  @IsDateString() @IsOptional() mammography_date?: string;
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  vaccines?: string[];
}

/** Medical → Chronic illnesses (checkbox set) */
export class MedicalChronicIllnessesDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  items?: string[];
}

/** Family History */
export class FamilyHistoryDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  gynecologic_cancers?: string[];
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  chronic_illnesses?: string[];
  @IsString() @IsOptional() @MaxLength(LONG) genetic_disorders?: string;
}

/** Fertility History */
export class FertilityHistoryDto {
  @IsString() @IsOptional() @MaxLength(SHORT) duration_of_infertility?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) partner_fertility_status?: string;
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  treatments?: string[];
  @IsString()
  @IsOptional()
  @MaxLength(LONG)
  menstrual_ovulation_patterns?: string;
  @IsString() @IsOptional() @MaxLength(LONG) past_pregnancies_outcomes?: string;
}

/** Social History (bonus, not in mockup but cheap to support) */
export class SocialHistoryDto {
  @IsString() @IsOptional() @MaxLength(SHORT) smoking?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) alcohol?: string;
  @IsString() @IsOptional() @MaxLength(SHORT) occupation?: string;
}

/** Bundle returned by GET /patients/:id/history */
export class PatientHistoryBundleDto {
  patient_id!: string;
  gynecological_baseline!: unknown;
  gynecologic_procedures!: unknown;
  screening_history!: unknown;
  obstetric_summary!: unknown;
  medical_chronic_illnesses!: unknown;
  family_history!: unknown;
  fertility_history!: unknown;
  social_history!: unknown;
}
