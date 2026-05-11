import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const META_SHORT = 256;
const SHORT = 256;
const LONG = 5000;

export class ChiefComplaintMetaDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  categories?: string[];
  @IsString() @IsOptional() @MaxLength(META_SHORT) onset?: string;
  @IsString() @IsOptional() @MaxLength(META_SHORT) duration?: string;
  @IsString() @IsOptional() @MaxLength(META_SHORT) severity?: string;
}

export class UpsertEncounterDto {
  @IsString() @IsOptional() @MaxLength(LONG) chief_complaint?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChiefComplaintMetaDto)
  chief_complaint_meta?: ChiefComplaintMetaDto;

  @IsString() @IsOptional() @MaxLength(LONG) history_present_illness?: string;

  /**
   * Specialty-specific fields, validated against the visit's bound
   * FormTemplateVersion.schema by FormSchemaValidatorService.
   */
  @IsObject() @IsOptional() responses?: Record<string, unknown>;

  @IsString() @IsOptional() @MaxLength(SHORT) provisional_diagnosis?: string;
  @IsString() @IsOptional() @MaxLength(64) diagnosis_code?: string;
  @IsString() @IsOptional() @MaxLength(64) diagnosis_certainty?: string;
  @IsString() @IsOptional() @MaxLength(LONG) clinical_reasoning?: string;
  @IsString() @IsOptional() @MaxLength(64) case_path?: string;
}

export class EncounterFormTemplateVersionDto {
  @ApiProperty() id!: string;
  @ApiProperty() version_number!: number;
  @ApiProperty({ type: Object }) schema!: unknown;
}

export class EncounterDto {
  @ApiProperty() id!: string;
  @ApiProperty() visit_id!: string;
  @ApiProperty({ nullable: true }) chief_complaint!: string | null;
  @ApiProperty({ type: Object, nullable: true }) chief_complaint_meta!: unknown;
  @ApiProperty({ nullable: true }) history_present_illness!: string | null;
  @ApiProperty({ type: Object }) responses!: unknown;
  @ApiProperty({ type: Object, nullable: true }) ai_analysis!: unknown;
  @ApiProperty({ nullable: true }) form_template_version_id!: string | null;
  @ApiProperty({ nullable: true, type: () => EncounterFormTemplateVersionDto })
  form_template_version!: EncounterFormTemplateVersionDto | null;
  @ApiProperty({ nullable: true }) provisional_diagnosis!: string | null;
  @ApiProperty({ nullable: true }) diagnosis_code!: string | null;
  @ApiProperty({ nullable: true }) diagnosis_certainty!: string | null;
  @ApiProperty({ nullable: true }) clinical_reasoning!: string | null;
  @ApiProperty({ nullable: true }) case_path!: string | null;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}
