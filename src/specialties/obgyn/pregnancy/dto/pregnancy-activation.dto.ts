import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * "Create pregnancy profile" payload (the activation drawer). Every field is
 * optional — the doctor can open the profile with nothing but the act of
 * confirming, and fill the summary afterwards via the clinical surface. Blood
 * group is NOT captured here — it is patient-level and lives in OB/GYN history.
 */
export class CreatePregnancyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  risk_level?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  lmp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  us_dating_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  us_ga_weeks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  us_ga_days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pregnancy_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  number_of_fetuses?: number;
}

/**
 * How a pregnancy ended. A pregnancy can close without a delivery (loss,
 * termination, transfer of care, …), so the outcome is a typed taxonomy rather
 * than a delivery-only record. `delivery_mode` applies only to `LIVE_BIRTH`.
 */
export const PREGNANCY_OUTCOME_TYPES = [
  'LIVE_BIRTH',
  'MISCARRIAGE',
  'STILLBIRTH',
  'ECTOPIC',
  'TERMINATION',
  'TRANSFERRED',
  'LOST_TO_FOLLOWUP',
  'OTHER',
] as const;
export type PregnancyOutcomeType = (typeof PREGNANCY_OUTCOME_TYPES)[number];

export const DELIVERY_MODES = ['VAGINAL', 'CESAREAN', 'ASSISTED'] as const;

export class PregnancyOutcomeDto {
  @ApiProperty({ enum: PREGNANCY_OUTCOME_TYPES })
  @IsIn(PREGNANCY_OUTCOME_TYPES)
  outcome_type!: PregnancyOutcomeType;

  @ApiPropertyOptional({
    enum: DELIVERY_MODES,
    description: 'Only for LIVE_BIRTH.',
  })
  @IsOptional()
  @IsIn(DELIVERY_MODES)
  delivery_mode?: (typeof DELIVERY_MODES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Close-the-pregnancy payload (records the outcome, completes the journey). */
export class ClosePregnancyDto {
  @ApiProperty({ type: PregnancyOutcomeDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PregnancyOutcomeDto)
  outcome!: PregnancyOutcomeDto;
}

export class PregnancyProfileDto {
  @ApiProperty() journey_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() created_at!: string;
}
