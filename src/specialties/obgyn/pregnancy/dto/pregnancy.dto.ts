import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// ---------- PregnancyJourneyRecord (snapshot, journey-level) ----------

export class PregnancySnapshotDto {
  @IsOptional() @IsIn(['ACTIVE', 'COMPLETED', 'TERMINATED']) status?: string;
  @IsOptional() @IsIn(['NORMAL', 'MODERATE', 'HIGH']) risk_level?: string;
  @IsOptional() @IsDateString() lmp?: string;
  @IsOptional() @IsString() blood_group_rh?: string;
  @IsOptional() @IsDateString() us_dating_date?: string;
  @IsOptional() @IsInt() @Min(0) @Max(42) us_ga_weeks?: number;
  @IsOptional() @IsInt() @Min(0) @Max(6) us_ga_days?: number;
  @IsOptional()
  @IsIn(['SINGLETON', 'TWINS', 'TRIPLETS', 'HIGHER_ORDER'])
  pregnancy_type?: string;
  @IsOptional() @IsInt() @Min(1) @Max(8) number_of_fetuses?: number;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsObject() delivery_plan?: Record<string, unknown>;
}

export class PregnancyJourneyRecordDto {
  id!: string;
  journey_id!: string;
  status!: string | null;
  risk_level!: string | null;
  lmp!: Date | null;
  blood_group_rh!: string | null;
  us_dating_date!: Date | null;
  us_ga_weeks!: number | null;
  us_ga_days!: number | null;
  pregnancy_type!: string | null;
  number_of_fetuses!: number | null;
  gender!: string | null;
  delivery_plan!: unknown;
  version!: number;
  @Type(() => Date) updated_at!: Date;
}

// ---------- PregnancyEpisodeRecord (trimester milestones) ----------

export class PregnancyEpisodeUpdateDto {
  @IsOptional() @IsObject() anomaly_scan?: Record<string, unknown>;
  @IsOptional() @IsObject() gtt_result?: Record<string, unknown>;
  @IsOptional() @IsObject() trimester_summary?: Record<string, unknown>;
}

export class PregnancyEpisodeRecordDto {
  id!: string;
  episode_id!: string;
  anomaly_scan!: unknown;
  gtt_result!: unknown;
  trimester_summary!: unknown;
  version!: number;
}

// ---------- VisitPregnancyRecord (per-ANC-visit measurements) ----------

export class CervixDto {
  @IsOptional() @IsNumber() cervix_length_mm?: number;
  @IsOptional() @IsNumber() cervix_dilatation_cm?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) cervix_effacement_pct?: number;
  @IsOptional()
  @IsIn(['ANTERIOR', 'MID', 'POSTERIOR'])
  cervix_position?: string;
  @IsOptional() @IsIn(['INTACT', 'RUPTURED', 'BULGING']) membranes?: string;
}

export class WarningSymptomsDto {
  @IsOptional() @IsBoolean() severe_headache?: boolean;
  @IsOptional() @IsBoolean() visual_disturbance?: boolean;
  @IsOptional() @IsBoolean() vaginal_bleeding?: boolean;
  @IsOptional() @IsBoolean() epigastric_ruq_pain?: boolean;
  @IsOptional() @IsBoolean() leakage_of_fluid?: boolean;
  @IsOptional() @IsBoolean() reduced_fetal_movements?: boolean;
  @IsOptional() @IsBoolean() severe_vomiting?: boolean;
}

export class FundalDto {
  @IsOptional() @IsNumber() fundal_height_cm?: number;
  @IsOptional()
  @IsIn(['YES', 'NO', 'LARGER', 'SMALLER'])
  fundal_corresponds_ga?: string;
}

export class AmnioticPlacentaDto {
  @IsOptional() @IsIn(['NORMAL', 'OLIGO', 'POLY']) amniotic_fluid?: string;
  @IsOptional()
  @IsIn(['ANTERIOR', 'POSTERIOR', 'FUNDAL', 'PREVIA'])
  placenta_location?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3) placenta_grade?: number;
}

export class FetalLieDto {
  @IsOptional()
  @IsIn(['LONGITUDINAL', 'TRANSVERSE', 'OBLIQUE'])
  fetal_lie?: string;
  @IsOptional() @IsIn(['CEPHALIC', 'BREECH', 'SHOULDER']) presentation?: string;
  @IsOptional()
  @IsIn(['ENGAGED', 'NOT_ENGAGED', 'PARTIAL'])
  engagement?: string;
}

export class BiometricsDto {
  @IsOptional() @IsInt() fetal_heart_rate_bpm?: number;
  @IsOptional() @IsIn(['REGULAR', 'IRREGULAR', 'ABSENT']) fetal_rhythm?: string;
  @IsOptional()
  @IsIn(['PRESENT', 'REDUCED', 'ABSENT'])
  fetal_movements?: string;
  @IsOptional() @IsNumber() bpd_mm?: number;
  @IsOptional() @IsNumber() hc_mm?: number;
  @IsOptional() @IsNumber() ac_mm?: number;
  @IsOptional() @IsNumber() fl_mm?: number;
  @IsOptional() @IsNumber() efw_g?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) growth_percentile?: number;
  @IsOptional() @IsIn(['AGA', 'SGA', 'LGA', 'IUGR']) growth_impression?: string;
}

export class VisitPregnancyRecordDto {
  id!: string;
  visit_id!: string;
  version!: number;
}

/**
 * Bulk PATCH body for the per-ANC pregnancy visit tab. Composes all the
 * sub-sections (cervix, warning symptoms, fundal, amniotic/placenta,
 * fetal lie, biometrics). Each is optional.
 */
export class UpdateVisitPregnancyRecordDto {
  // Cervix
  @IsOptional() @IsNumber() cervix_length_mm?: number;
  @IsOptional() @IsNumber() cervix_dilatation_cm?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) cervix_effacement_pct?: number;
  @IsOptional()
  @IsIn(['ANTERIOR', 'MID', 'POSTERIOR'])
  cervix_position?: string;
  @IsOptional() @IsIn(['INTACT', 'RUPTURED', 'BULGING']) membranes?: string;

  // Warning symptoms (single JSON column)
  @IsOptional() @IsObject() warning_symptoms?: WarningSymptomsDto;

  // Fundal
  @IsOptional() @IsNumber() fundal_height_cm?: number;
  @IsOptional()
  @IsIn(['YES', 'NO', 'LARGER', 'SMALLER'])
  fundal_corresponds_ga?: string;

  // Amniotic & placenta
  @IsOptional() @IsIn(['NORMAL', 'OLIGO', 'POLY']) amniotic_fluid?: string;
  @IsOptional()
  @IsIn(['ANTERIOR', 'POSTERIOR', 'FUNDAL', 'PREVIA'])
  placenta_location?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3) placenta_grade?: number;

  // Fetal lie
  @IsOptional()
  @IsIn(['LONGITUDINAL', 'TRANSVERSE', 'OBLIQUE'])
  fetal_lie?: string;
  @IsOptional() @IsIn(['CEPHALIC', 'BREECH', 'SHOULDER']) presentation?: string;
  @IsOptional()
  @IsIn(['ENGAGED', 'NOT_ENGAGED', 'PARTIAL'])
  engagement?: string;

  // Biometrics
  @IsOptional() @IsInt() fetal_heart_rate_bpm?: number;
  @IsOptional() @IsIn(['REGULAR', 'IRREGULAR', 'ABSENT']) fetal_rhythm?: string;
  @IsOptional()
  @IsIn(['PRESENT', 'REDUCED', 'ABSENT'])
  fetal_movements?: string;
  @IsOptional() @IsNumber() bpd_mm?: number;
  @IsOptional() @IsNumber() hc_mm?: number;
  @IsOptional() @IsNumber() ac_mm?: number;
  @IsOptional() @IsNumber() fl_mm?: number;
  @IsOptional() @IsNumber() efw_g?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) growth_percentile?: number;
  @IsOptional() @IsIn(['AGA', 'SGA', 'LGA', 'IUGR']) growth_impression?: string;
}
