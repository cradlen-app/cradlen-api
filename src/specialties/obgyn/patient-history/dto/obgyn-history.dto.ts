import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BloodGroupRh } from '@prisma/client';

// JSON sub-shapes — kept lightweight; class-validator enforces only top-level
// presence and basic typing. Free-form fields stay free-form to match early-
// phase UI iteration. Both the singleton sections AND the repeatable child
// collections below are persisted as JSON columns on `PatientObgynHistory`
// (one history table per specialty — the former child tables were folded back
// into JSON; see @specialties/obgyn/patient-history/obgyn-history.service).

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
  @IsOptional() @IsString() vaccines_other?: string;
  @IsOptional() @IsString() hpv_result?: string;
  @IsOptional() @IsString() bethesda_category?: string;
  // Health-maintenance dates (Stanford parity)
  @IsOptional() @IsString() last_colonoscopy?: string;
  @IsOptional() @IsString() last_bone_density?: string;
  @IsOptional() @IsString() last_tetanus?: string;
  @IsOptional() @IsString() last_flu?: string;
}

export class GynecologicConditionsDto {
  @IsOptional() @IsArray() @IsString({ each: true }) items?: string[];
  @IsOptional() @IsString() notes?: string;
}

export class SexualHistoryDto {
  @IsOptional() @IsNumber() age_first_intercourse?: number;
  @IsOptional() @IsString() num_partners?: string;
  @IsOptional() @IsString() partner_gender?: string;
  @IsOptional() @IsString() currently_active?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) sti_history?: string[];
  @IsOptional() @IsString() sti_history_other?: string;
}

export class ObstetricSummaryDto {
  @IsOptional() @IsInt() @Min(0) gravida?: number;
  @IsOptional() @IsInt() @Min(0) para?: number;
  @IsOptional() @IsInt() @Min(0) abortion?: number;
  @IsOptional() @IsInt() @Min(0) ectopic?: number;
  @IsOptional() @IsInt() @Min(0) stillbirths?: number;
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
  @IsOptional() @IsString() gynecologic_cancers_other?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chronic_illnesses?: string[];
  @IsOptional() @IsString() chronic_illnesses_other?: string;
  @IsOptional() @IsString() genetic_disorders?: string;
}

export class FertilityHistoryDto {
  @IsOptional() @IsString() duration_of_infertility?: string;
  @IsOptional() @IsString() partner_fertility_status?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) treatments?: string[];
  @IsOptional() @IsString() treatments_other?: string;
  @IsOptional() @IsString() menstrual_ovulation_patterns?: string;
  @IsOptional() @IsString() past_pregnancies_outcomes?: string;
}

export class SocialHistoryDto {
  @IsOptional() @IsString() smoking?: string;
  @IsOptional() @IsString() smoking_status?: string;
  @IsOptional() @IsString() smoking_detail?: string;
  @IsOptional() @IsString() alcohol?: string;
  @IsOptional() @IsString() recreational_drugs?: string;
  @IsOptional() @IsString() exercise?: string;
  @IsOptional() @IsString() occupation?: string;
  @IsOptional() @IsString() employer?: string;
  @IsOptional() @IsString() ethnicity?: string;
}

export class MenopauseHistoryDto {
  @IsOptional() @IsString() menopausal_status?: string;
  @IsOptional() @IsNumber() age_at_menopause?: number;
  @IsOptional() @IsString() hrt_current?: string;
  @IsOptional() @IsString() hrt_details?: string;
}

// ---------------------------------------------------------------------------
// Repeatable child rows, stored as JSON arrays on the singleton. Each row
// carries an optional `id`:
//   - id present → update that row
//   - id absent  → create a new row (server assigns the `id`)
//   - any live row whose id is missing from the array → removed from the array
//     (prior state is retained in the patient_obgyn_history_revisions snapshot)
// Sending the key as `[]` clears the collection; omitting the key leaves it
// untouched.
// ---------------------------------------------------------------------------

export class PregnancyRowDto {
  @IsOptional() @IsUUID() id?: string;
  // Server-stamped by the pregnancy activation/close sync (links the row to its
  // PatientJourney); whitelisted so FE echoes of the envelope don't 400.
  @IsOptional() @IsUUID() journey_id?: string;
  @IsOptional() @IsDateString() birth_date?: string;
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsString() mode_of_delivery?: string;
  @IsOptional() @IsString() mode_of_delivery_other?: string;
  @IsOptional() @IsInt() gestational_age_weeks?: number;
  @IsOptional() @IsString() neonatal_outcome?: string;
  @IsOptional() @IsString() neonatal_outcome_other?: string;
  @IsOptional() @IsString() baby_weight?: string;
  @IsOptional() @IsString() baby_sex?: string;
  @IsOptional() @IsString() complications?: string;
  @IsOptional() @IsString() notes?: string;
}

export class FamilyHistoryRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsString() relative?: string;
  @IsOptional() @IsInt() age_of_diagnosis?: number;
  @IsOptional() @IsString() notes?: string;
}

export class ContraceptiveRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() method_other?: string;
  @IsOptional() @IsString() duration?: string;
  @IsOptional() @IsString() complications?: string;
  @IsOptional() @IsString() notes?: string;
}

export class NonGynSurgeryRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() surgery_name?: string;
  @IsOptional() @IsDateString() surgery_date?: string;
  @IsOptional() @IsString() facility?: string;
  @IsOptional() @IsString() notes?: string;
}

export class GynSurgeryRowDto {
  @IsOptional() @IsUUID() id?: string;
  // Server-stamped by the surgical activation/close sync (links the row to its
  // PatientJourney); whitelisted so FE echoes of the envelope don't 400.
  @IsOptional() @IsUUID() journey_id?: string;
  @IsOptional() @IsString() procedure_code?: string;
  @IsOptional() @IsString() procedure_name?: string;
  @IsOptional() @IsDateString() surgery_date?: string;
  // PLANNED | COMPLETED | ABORTED | CONVERTED | TRANSFERRED | DECEASED | OTHER
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsString() anesthesia_type?: string;
  @IsOptional() @IsString() complications?: string;
  @IsOptional() @IsString() notes?: string;
}

export class MedicationRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() medication_id?: string;
  @IsOptional() @IsString() drug_name?: string;
  @IsOptional() @IsString() indication?: string;
  @IsOptional() @IsString() dose?: string;
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @IsDateString() from_date?: string;
  @IsOptional() @IsDateString() to_date?: string;
  @IsOptional() @IsBoolean() is_ongoing?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class AllergyRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() allergy_to?: string;
  @IsOptional() @IsString() associated_symptoms?: string;
  @IsOptional() @IsString() severity?: string;
  @IsOptional() @IsString() notes?: string;
}

/**
 * Bulk PATCH body for the OB/GYN history tab. Every field is optional —
 * unsent sections are left untouched on the server. One PATCH = one
 * transactional update across the singleton row + every child collection
 * = one revision shadow row = one `patient.history.updated` event listing
 * the sections that actually changed.
 */
export class UpdateObgynHistoryDto {
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
  @Type(() => GynecologicConditionsDto)
  gynecologic_conditions?: GynecologicConditionsDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SexualHistoryDto)
  sexual_history?: SexualHistoryDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ScreeningHistoryDto)
  screening_history?: ScreeningHistoryDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ObstetricSummaryDto)
  obstetric_summary?: ObstetricSummaryDto;

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

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MenopauseHistoryDto)
  menopause_history?: MenopauseHistoryDto;

  @IsOptional()
  @IsEnum(BloodGroupRh)
  blood_group_rh?: BloodGroupRh;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PregnancyRowDto)
  pregnancies?: PregnancyRowDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContraceptiveRowDto)
  contraceptives?: ContraceptiveRowDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NonGynSurgeryRowDto)
  non_gyn_surgeries?: NonGynSurgeryRowDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GynSurgeryRowDto)
  gyn_surgeries?: GynSurgeryRowDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FamilyHistoryRowDto)
  family_members?: FamilyHistoryRowDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MedicationRowDto)
  medications?: MedicationRowDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllergyRowDto)
  allergies?: AllergyRowDto[];
}

export class PatientObgynHistoryDto {
  patient_id!: string;
  gynecological_baseline!: unknown;
  gynecologic_procedures!: unknown;
  gynecologic_conditions!: unknown;
  sexual_history!: unknown;
  screening_history!: unknown;
  obstetric_summary!: unknown;
  medical_chronic_illnesses!: unknown;
  family_history!: unknown;
  fertility_history!: unknown;
  social_history!: unknown;
  menopause_history!: unknown;
  blood_group_rh!: BloodGroupRh | null;
  section_timestamps!: Record<string, string> | null;
  pregnancies!: unknown[];
  contraceptives!: unknown[];
  non_gyn_surgeries!: unknown[];
  gyn_surgeries!: unknown[];
  family_members!: unknown[];
  medications!: unknown[];
  allergies!: unknown[];
  version!: number;
  @Type(() => Date) updated_at!: Date;
}
