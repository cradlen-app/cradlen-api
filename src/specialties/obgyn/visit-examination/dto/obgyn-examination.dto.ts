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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LabTestCategory } from '@prisma/client';
import { UpdateObgynHistoryDto } from '../../patient-history/dto/obgyn-history.dto';

/**
 * Chief-complaint metadata sub-shape. Mirrors the JSON column
 * `visit_encounters.chief_complaint_meta`. Free-form by design (categories
 * are template-driven, not enum-fixed) but the keys are typed.
 */
export class ChiefComplaintMetaDto {
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @IsString() onset?: string;
  @IsOptional() @IsString() duration?: string;
  @IsOptional() @IsString() severity?: string;
}

/**
 * Vitals payload. Mirrors `visit_vitals` columns. `bmi` is server-computed
 * and intentionally not accepted from the client.
 */
export class VitalsDto {
  @IsOptional() @IsInt() @Min(50) @Max(250) systolic_bp?: number;
  @IsOptional() @IsInt() @Min(30) @Max(200) diastolic_bp?: number;
  @IsOptional() @IsInt() @Min(20) @Max(250) pulse?: number;
  @IsOptional() @IsNumber() @Min(30) @Max(45) temperature_c?: number;
  @IsOptional() @IsInt() @Min(5) @Max(60) respiratory_rate?: number;
  @IsOptional() @IsInt() @Min(50) @Max(100) spo2?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(400) weight_kg?: number;
  @IsOptional() @IsNumber() @Min(30) @Max(250) height_cm?: number;
  @IsOptional() @IsNumber() rbs_mmol_l?: number;
}

/**
 * Repeatable child rows. Each row carries an optional `id`:
 *   - id present → update that row
 *   - id absent  → create a new row
 *   - any live row whose id is missing from the array → soft-delete
 * Sending the key as `[]` clears the collection; omitting the key leaves it
 * untouched.
 */
export class InvestigationRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() lab_test_id?: string;
  @IsOptional() @IsString() custom_test_name?: string;
  @IsOptional() @IsEnum(LabTestCategory) test_category?: LabTestCategory;
  @IsOptional() @IsString() lab_facility?: string;
  @IsOptional() @IsString() notes?: string;
}

export class DiagnosisRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() is_primary?: boolean;
  @IsOptional() @IsString() certainty?: string;
}

export class MedicationItemRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() medication_id?: string;
  @IsOptional() @IsString() custom_drug_name?: string;
  @IsOptional() @IsString() dose?: string;
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @IsString() duration?: string;
  @IsOptional() @IsString() instructions?: string;
}

/**
 * Bulk PATCH body for the OB/GYN Examination tab. Single payload, single
 * transaction, fans out across five aggregates:
 *
 *  - VisitEncounter      (chief complaint + provisional diagnosis)
 *  - VisitVitals         (vitals, BMI recomputed server-side)
 *  - VisitObgynEncounter (all 10 body-system findings JSON sections)
 *  - VisitInvestigation  (id-keyed row diff)
 *  - Prescription + PrescriptionItem (singleton + id-keyed row diff)
 *  - Visit               (follow_up_date + examination_version bump)
 *
 * Every field optional — unsent surfaces are left untouched on the server.
 */
export class UpdateObgynExaminationDto {
  // VisitEncounter — chief complaint
  @IsOptional() @IsString() chief_complaint?: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChiefComplaintMetaDto)
  chief_complaint_meta?: ChiefComplaintMetaDto;

  // VisitEncounter — provisional diagnosis
  @IsOptional() @IsString() provisional_diagnosis?: string;
  @IsOptional() @IsString() diagnosis_code?: string;
  @IsOptional() @IsString() diagnosis_certainty?: string;
  @IsOptional() @IsString() clinical_reasoning?: string;
  @IsOptional() @IsString() case_path?: string;

  // VisitVitals
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => VitalsDto)
  vitals?: VitalsDto;

  // VisitObgynEncounter JSON sections (all 10 body-system findings)
  @IsOptional() @IsObject() general_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() cardiovascular_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() respiratory_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() menstrual_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() abdominal_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() pelvic_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() breast_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() extremities_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() neurological_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() skin_findings?: Record<string, unknown>;

  // VisitDiagnosis rows (id-keyed diff) — structured ICD-10 diagnosis list
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagnosisRowDto)
  diagnoses?: DiagnosisRowDto[];

  // VisitInvestigation rows (id-keyed diff)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvestigationRowDto)
  investigations?: InvestigationRowDto[];

  // PrescriptionItem rows (id-keyed diff)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MedicationItemRowDto)
  medications?: MedicationItemRowDto[];

  // Visit-level
  @IsOptional() @IsDateString() follow_up_date?: string;

  /**
   * Care-path-relevant patient history captured during the encounter. Routed to
   * the patient-level `PatientObgynHistory` tables (single source of truth) via
   * `ObgynHistoryService.applyPatch` inside the same transaction — feeds the
   * read-only full-history tab. Reuses the full history DTO (same id-keyed
   * child-diff semantics); the frontend assembles only the sections the chosen
   * care path surfaces.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateObgynHistoryDto)
  obgyn_history?: UpdateObgynHistoryDto;
}

export class VisitExaminationEnvelopeDto {
  visit_id!: string;
  chief_complaint!: string | null;
  chief_complaint_meta!: unknown;
  provisional_diagnosis!: string | null;
  diagnosis_code!: string | null;
  diagnosis_certainty!: string | null;
  clinical_reasoning!: string | null;
  case_path!: string | null;
  vitals!: unknown;
  general_findings!: unknown;
  cardiovascular_findings!: unknown;
  respiratory_findings!: unknown;
  menstrual_findings!: unknown;
  abdominal_findings!: unknown;
  pelvic_findings!: unknown;
  breast_findings!: unknown;
  extremities_findings!: unknown;
  neurological_findings!: unknown;
  skin_findings!: unknown;
  diagnoses!: unknown[];
  investigations!: unknown[];
  medications!: unknown[];
  follow_up_date!: string | null;
  /**
   * The patient's current OB/GYN history envelope (singleton sections + the five
   * child collections + `version`), or `null` if none yet. Pre-fills the
   * care-path-relevant `history_*` sections in the examination tab. Same shape
   * as the patient-history GET.
   */
  obgyn_history!: unknown;
  examination_version!: number;
  obgyn_encounter_version!: number;
  @Type(() => Date) updated_at!: Date;
}
