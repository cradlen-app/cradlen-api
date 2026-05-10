import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const META_SHORT = 256;

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
import {
  AbdominalFindingsDto,
  BreastFindingsDto,
  CardiovascularFindingsDto,
  ExtremitiesFindingsDto,
  GeneralFindingsDto,
  MenstrualFindingsDto,
  NeurologicalFindingsDto,
  PelvicFindingsDto,
  RespiratoryFindingsDto,
  SkinFindingsDto,
} from './exam-findings.dto';

const SHORT = 256;
const LONG = 5000;

export class UpsertEncounterDto {
  @IsString() @IsOptional() @MaxLength(LONG) chief_complaint?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChiefComplaintMetaDto)
  chief_complaint_meta?: ChiefComplaintMetaDto;

  @IsString() @IsOptional() @MaxLength(LONG) history_present_illness?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeneralFindingsDto)
  general_findings?: GeneralFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CardiovascularFindingsDto)
  cardiovascular_findings?: CardiovascularFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RespiratoryFindingsDto)
  respiratory_findings?: RespiratoryFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MenstrualFindingsDto)
  menstrual_findings?: MenstrualFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AbdominalFindingsDto)
  abdominal_findings?: AbdominalFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PelvicFindingsDto)
  pelvic_findings?: PelvicFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BreastFindingsDto)
  breast_findings?: BreastFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExtremitiesFindingsDto)
  extremities_findings?: ExtremitiesFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NeurologicalFindingsDto)
  neurological_findings?: NeurologicalFindingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SkinFindingsDto)
  skin_findings?: SkinFindingsDto;

  @IsString() @IsOptional() @MaxLength(SHORT) provisional_diagnosis?: string;
  @IsString() @IsOptional() @MaxLength(64) diagnosis_code?: string;
  @IsString() @IsOptional() @MaxLength(64) diagnosis_certainty?: string;
  @IsString() @IsOptional() @MaxLength(LONG) clinical_reasoning?: string;
  @IsString() @IsOptional() @MaxLength(64) case_path?: string;
}

export class EncounterDto {
  id!: string;
  visit_id!: string;
  chief_complaint!: string | null;
  chief_complaint_meta!: unknown;
  history_present_illness!: string | null;
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
  provisional_diagnosis!: string | null;
  diagnosis_code!: string | null;
  diagnosis_certainty!: string | null;
  clinical_reasoning!: string | null;
  case_path!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
