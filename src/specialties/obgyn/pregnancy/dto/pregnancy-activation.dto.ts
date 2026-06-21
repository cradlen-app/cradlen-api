import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
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
 * confirming, and fill the snapshot afterwards via the clinical surface.
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
  @IsString()
  blood_group_rh?: string;

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

/** The structured delivery outcome captured when closing a pregnancy. */
export class DeliveryOutcomeDto {
  @ApiPropertyOptional({ description: 'e.g. VAGINAL | CESAREAN | ASSISTED' })
  @IsOptional()
  @IsString()
  mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Close-the-pregnancy payload (records delivery, completes the journey). */
export class ClosePregnancyDto {
  @ApiPropertyOptional({ type: DeliveryOutcomeDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeliveryOutcomeDto)
  delivery_outcome?: DeliveryOutcomeDto;
}

export class PregnancyProfileDto {
  @ApiProperty() journey_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() created_at!: string;
}
