import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/**
 * One fetus row in the repeatable "Fetuses" section. Scalars arrive as strings
 * (the generic form shell submits input values verbatim); the service coerces
 * ints/decimals. `id` round-trips an existing `VisitFetalRecord` for the
 * id-keyed diff (present → update, absent → create, missing live id →
 * soft-delete).
 */
export class PregnancyFetusRowDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  fetus_label?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  fetal_lie?: string;

  @IsOptional()
  @IsString()
  presentation?: string;

  @IsOptional()
  @IsString()
  engagement?: string;

  @IsOptional()
  @IsString()
  fetal_heart_rate_bpm?: string;

  @IsOptional()
  @IsString()
  fetal_rhythm?: string;

  @IsOptional()
  @IsString()
  fetal_movements?: string;

  @IsOptional()
  @IsString()
  bpd_mm?: string;

  @IsOptional()
  @IsString()
  hc_mm?: string;

  @IsOptional()
  @IsString()
  ac_mm?: string;

  @IsOptional()
  @IsString()
  fl_mm?: string;

  @IsOptional()
  @IsString()
  efw_g?: string;

  @IsOptional()
  @IsString()
  growth_percentile?: string;

  @IsOptional()
  @IsString()
  growth_impression?: string;
}

/**
 * Flat PATCH body for the pregnancy clinical surface. Keys mirror the
 * `obgyn_pregnancy` template's binding paths (= the scoped record columns); the
 * service demuxes each into the journey / episode / per-visit / per-fetus
 * record by namespace. Thin/shape-only by design (no `@ValidateIf`) — all
 * conditional logic lives in the template predicates. `status` / `created_at` /
 * `updated_at` are accepted (the read-only profile display fields submit them)
 * but ignored by the writable allow-list.
 */
export class UpdatePregnancyClinicalDto {
  // Journey scope (snapshot)
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() created_at?: string;
  @IsOptional() @IsString() updated_at?: string;
  @IsOptional() @IsString() risk_level?: string;
  @IsOptional() @IsString() lmp?: string;
  @IsOptional() @IsString() blood_group_rh?: string;
  @IsOptional() @IsString() us_dating_date?: string;
  @IsOptional() @IsString() us_ga_weeks?: string;
  @IsOptional() @IsString() us_ga_days?: string;
  @IsOptional() @IsString() pregnancy_type?: string;
  @IsOptional() @IsString() number_of_fetuses?: string;
  @IsOptional() @IsString() gender?: string;

  // Episode scope (JSON labs)
  @IsOptional() @IsObject() anomaly_scan?: Record<string, unknown>;
  @IsOptional() @IsObject() gtt_result?: Record<string, unknown>;
  @IsOptional() @IsObject() trimester_summary?: Record<string, unknown>;

  // Per-visit scope (maternal + shared fetal context)
  @IsOptional() @IsString() cervix_length_mm?: string;
  @IsOptional() @IsString() cervix_dilatation_cm?: string;
  @IsOptional() @IsString() cervix_effacement_pct?: string;
  @IsOptional() @IsString() cervix_position?: string;
  @IsOptional() @IsString() membranes?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warning_symptoms?: string[];
  @IsOptional() @IsString() fundal_height_cm?: string;
  @IsOptional() @IsString() fundal_corresponds_ga?: string;
  @IsOptional() @IsString() amniotic_fluid?: string;
  @IsOptional() @IsString() placenta_location?: string;
  @IsOptional() @IsString() placenta_grade?: string;
  @IsOptional() additional_findings?: unknown;

  // Per-fetus scope (repeatable)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PregnancyFetusRowDto)
  fetuses?: PregnancyFetusRowDto[];
}

/**
 * Swagger shape only — the real envelope is a flat, template-driven object with
 * the journey/episode/visit columns plus computed `ga_*`/`edd_*` and a
 * `fetuses[]` array. Extra keys are expected.
 */
export class PregnancyClinicalEnvelopeDto {
  @ApiProperty() journey_id!: string;
  @ApiProperty() version!: number;
  [key: string]: unknown;
}
