import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { UpsertVitalsDto } from '../../clinical/dto/vitals.dto';
import { ChiefComplaintMetaDto } from '../../clinical/dto/encounter.dto';

const LONG = 5000;

/**
 * Optional intake captured at booking / first edit (reception or nurse).
 * Replaces the legacy free-text `notes` field with structured complaint + vitals.
 * Doctor refines complaint and writes the rest of the encounter once visit is IN_PROGRESS.
 */
export class VisitIntakeFieldsDto {
  @IsString() @IsOptional() @MaxLength(LONG) chief_complaint?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChiefComplaintMetaDto)
  chief_complaint_meta?: ChiefComplaintMetaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertVitalsDto)
  vitals?: UpsertVitalsDto;
}
