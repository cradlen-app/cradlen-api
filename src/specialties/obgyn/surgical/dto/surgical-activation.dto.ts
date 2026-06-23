import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PregnancyOutcomeDto } from '../../pregnancy/dto/pregnancy-activation.dto';

/**
 * "Create surgical profile" payload (the activation drawer). All surgery-profile
 * fields are optional — the doctor opens the profile by confirming and fills the
 * details via the clinical surface afterwards.
 *
 * `pregnancy_outcome` is the cesarean handoff: when the patient has an ACTIVE
 * pregnancy journey, the surface must confirm closing it first. Absent + active
 * pregnancy → `409 PREGNANCY_ACTIVE_REQUIRES_CLOSE`; present → the pregnancy is
 * closed (with this outcome) and the surgical journey opens, cross-linked, in one
 * transaction.
 */
export class CreateSurgicalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  procedure_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  procedure_code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  procedure_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  indication?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  planned_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  surgery_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  urgency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  anesthesia_type?: string;

  @ApiPropertyOptional({
    type: PregnancyOutcomeDto,
    description:
      'Confirms the cesarean handoff: closes the active pregnancy with this outcome before opening the surgical journey.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PregnancyOutcomeDto)
  pregnancy_outcome?: PregnancyOutcomeDto;
}

/**
 * How a surgical journey ended. Unlike a pregnancy there is no delivery taxonomy
 * — a surgery is recorded as completed/aborted/converted/transferred, with any
 * complications captured separately.
 */
export const SURGICAL_OUTCOME_TYPES = [
  'COMPLETED',
  'ABORTED',
  'CONVERTED',
  'TRANSFERRED',
  'DECEASED',
  'OTHER',
] as const;
export type SurgicalOutcomeType = (typeof SURGICAL_OUTCOME_TYPES)[number];

export class SurgicalOutcomeDto {
  @ApiProperty({ enum: SURGICAL_OUTCOME_TYPES })
  @IsIn(SURGICAL_OUTCOME_TYPES)
  outcome_type!: SurgicalOutcomeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  complications?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Close-the-surgical-journey payload (records the outcome, completes the journey). */
export class CloseSurgicalDto {
  @ApiProperty({ type: SurgicalOutcomeDto })
  @IsObject()
  @ValidateNested()
  @Type(() => SurgicalOutcomeDto)
  outcome!: SurgicalOutcomeDto;
}

export class SurgicalProfileDto {
  @ApiProperty() journey_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() created_at!: string;
}
